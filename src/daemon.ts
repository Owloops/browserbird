/** @fileoverview Main orchestrator process: starts all subsystems and handles graceful shutdown. */

import { logger } from './core/logger.ts';
import { BANNER } from './cli/banner.ts';
import {
  loadConfig,
  loadRawConfig,
  loadDotEnv,
  ensureMcpConfig,
  getBrowserMode,
} from './config.ts';
import { clearBrowserLock } from './browser/lock.ts';
import { openDatabase, closeDatabase, resolveDbPath } from './db/index.ts';
import { startWorker } from './jobs.ts';
import { startScheduler } from './cron/scheduler.ts';
import { createSlackChannel } from './channel/slack.ts';
import { createWebServer } from './server/index.ts';
import type { WebServerDeps } from './server/index.ts';
import { startHealthChecks, getServiceHealth } from './server/health.ts';
import type { Config } from './core/types.ts';
import type { ChannelHandle } from './channel/types.ts';
import { resolve, dirname } from 'node:path';

const controller = new AbortController();

const SHUTDOWN_TIMEOUT_MS = 5000;

function setupShutdown(): void {
  let shutting = false;

  const shutdown = (signal: string) => {
    if (shutting) {
      logger.info(`received ${signal} again, forcing exit`);
      process.exit(1);
    }
    shutting = true;
    logger.info(`received ${signal}, shutting down...`);
    controller.abort();

    setTimeout(() => {
      logger.warn('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

interface DaemonOptions {
  flags: { verbose: boolean; config?: string; db?: string };
}

export async function startDaemon(options: DaemonOptions): Promise<void> {
  setupShutdown();
  logger.setMode('daemon');
  process.stdout.write(BANNER + '\n\n');

  if (options.flags.verbose) {
    logger.setLevel('debug');
  }

  const configPath = resolve(
    options.flags.config ?? process.env['BROWSERBIRD_CONFIG'] ?? 'browserbird.json',
  );
  const configDir = dirname(configPath);
  const envPath = resolve(configDir, '.env');
  const dbPath = resolveDbPath(options.flags.db);
  openDatabase(dbPath);
  clearBrowserLock();
  startWorker(controller.signal);

  loadDotEnv(envPath);
  let currentConfig: Config;
  let slackHandle: ChannelHandle | null = null;

  let schedulerStarted = false;
  let slackStarted = false;
  let healthStarted = false;

  try {
    currentConfig = loadConfig(configPath);
    ensureMcpConfig(currentConfig, configDir);
  } catch (err) {
    logger.warn(`config validation failed: ${err instanceof Error ? err.message : String(err)}`);
    currentConfig = loadRawConfig(configPath) as unknown as Config;
  }

  const getConfig = (): Config => currentConfig;
  const getDeps = (): WebServerDeps => ({
    slackConnected: () => slackHandle?.isConnected() ?? false,
    activeProcessCount: () => slackHandle?.activeCount() ?? 0,
    serviceHealth: () => getServiceHealth(currentConfig),
  });

  let activated = false;

  const activateLayers = (config: Config) => {
    currentConfig = config;

    if (!schedulerStarted && config.agents.length > 0) {
      logger.info('starting scheduler...');
      startScheduler(getConfig, controller.signal, {
        postToSlack: (channel, text, opts) =>
          slackHandle ? slackHandle.postMessage(channel, text, opts) : Promise.resolve(),
      });
      schedulerStarted = true;
    }

    if (!healthStarted) {
      startHealthChecks(getConfig, controller.signal);
      healthStarted = true;
    }

    if (!slackStarted && config.slack.botToken && config.slack.appToken) {
      logger.info('connecting to slack...');
      slackHandle = createSlackChannel(getConfig, controller.signal);
      slackHandle.start().catch((err: unknown) => {
        logger.error(`slack failed to start: ${err instanceof Error ? err.message : String(err)}`);
      });
      slackStarted = true;
    }

    if (!activated) {
      logger.success('browserbird orchestrator started');
      logger.info(`agents: ${config.agents.map((a) => a.id).join(', ') || 'none'}`);
      if (!slackStarted) logger.info('slack: not configured');
      logger.info(`max concurrent sessions: ${config.sessions.maxConcurrent}`);
      if (config.browser.enabled) {
        logger.info(`browser mode: ${getBrowserMode()}`);
      }
      activated = true;
    }
  };

  const onLaunch = async () => {
    loadDotEnv(envPath);
    const config = loadConfig(configPath);
    ensureMcpConfig(config, configDir);
    activateLayers(config);
  };

  const reloadConfig = (): void => {
    loadDotEnv(envPath);
    const config = loadConfig(configPath);
    ensureMcpConfig(config, configDir);
    activateLayers(config);
    logger.info('config reloaded');
  };

  if (currentConfig.agents.length > 0) {
    activateLayers(currentConfig);
  } else {
    logger.info('no agents configured');
  }

  let webServer: Awaited<ReturnType<typeof createWebServer>> | null = null;
  const webConfig = getConfig();
  if (webConfig.web.enabled) {
    logger.info(`starting web server on port ${webConfig.web.port}...`);
    webServer = createWebServer(getConfig, controller.signal, getDeps, {
      configPath,
      envPath,
      onLaunch,
      onConfigReload: reloadConfig,
    });
    await webServer.start();
  }

  await new Promise<void>((resolvePromise) => {
    controller.signal.addEventListener('abort', () => {
      resolvePromise();
    });
  });

  if (webServer) await webServer.stop();
  if (slackHandle as ChannelHandle | null) {
    await Promise.race([slackHandle!.stop(), new Promise<void>((r) => setTimeout(r, 3000))]);
  }
  closeDatabase();
  logger.info('browserbird stopped');
}

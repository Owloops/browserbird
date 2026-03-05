/** @fileoverview Main orchestrator process: starts all subsystems and handles graceful shutdown. */

import { logger } from './core/logger.ts';
import { BANNER } from './cli/banner.ts';
import { loadConfig, loadDotEnv, hasSlackTokens, ensureMcpConfig, getBrowserMode } from './config.ts';
import { openDatabase, closeDatabase, setSetting, resolveDbPath } from './db/index.ts';
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

const stubDeps: WebServerDeps = {
  slackConnected: () => false,
  activeProcessCount: () => 0,
  serviceHealth: () => ({ agent: { available: false }, browser: { connected: false } }),
};

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
  startWorker(controller.signal);

  loadDotEnv(envPath);
  let currentConfig: Config = loadConfig(configPath);
  ensureMcpConfig(currentConfig, configDir);
  let slackHandle: ChannelHandle | null = null;
  let setupMode = true;

  const getConfig = (): Config => currentConfig;
  const getDeps = (): WebServerDeps => {
    if (setupMode) return stubDeps;
    return {
      slackConnected: () => slackHandle?.isConnected() ?? false,
      activeProcessCount: () => slackHandle?.activeCount() ?? 0,
      serviceHealth: () => getServiceHealth(currentConfig),
    };
  };

  const startFull = (config: Config) => {
    currentConfig = config;
    setupMode = false;

    logger.info('connecting to slack...');
    slackHandle = createSlackChannel(config, controller.signal);

    logger.info('starting scheduler...');
    startScheduler(config, controller.signal, {
      postToSlack: (channel, text, opts) => slackHandle!.postMessage(channel, text, opts),
    });

    slackHandle.start().catch((err: unknown) => {
      logger.error(`slack failed to start: ${err instanceof Error ? err.message : String(err)}`);
    });

    startHealthChecks(getConfig, controller.signal);

    logger.success('browserbird orchestrator started');
    logger.info(`agents: ${config.agents.map((a) => a.id).join(', ')}`);
    logger.info(`max concurrent sessions: ${config.sessions.maxConcurrent}`);
    if (config.browser.enabled) {
      logger.info(`browser mode: ${getBrowserMode()}`);
    }
  };

  const onLaunch = async () => {
    loadDotEnv(envPath);
    const config = loadConfig(configPath);
    ensureMcpConfig(config, configDir);

    if (!config.slack.botToken || !config.slack.appToken) {
      throw new Error('Slack tokens are required to launch');
    }

    startFull(config);
  };

  const reloadConfig = (): void => {
    loadDotEnv(envPath);
    currentConfig = loadConfig(configPath);
    ensureMcpConfig(currentConfig, configDir);
    logger.info('config reloaded');
  };

  if (hasSlackTokens(configPath)) {
    if (!currentConfig.slack.botToken || !currentConfig.slack.appToken) {
      throw new Error(
        'slack tokens not resolvable (set SLACK_BOT_TOKEN/SLACK_APP_TOKEN or configure in browserbird.json)',
      );
    }

    setSetting('onboarding_completed', 'true');
    startFull(currentConfig);
  } else {
    setSetting('onboarding_completed', '');
    logger.info('starting in setup mode (onboarding not completed)');
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

  if (setupMode) {
    logger.info('waiting for onboarding to complete via web UI');
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

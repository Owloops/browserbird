/** @fileoverview Main orchestrator process: starts all subsystems and handles graceful shutdown. */

import { logger } from './core/logger.ts';
import { BANNER } from './cli/banner.ts';
import {
  loadConfig,
  loadRawConfig,
  loadDotEnv,
  ensureMcpConfig,
  getBrowserMode,
  DEFAULT_CONFIG_PATH,
} from './config.ts';
import { clearBrowserLock } from './browser/lock.ts';
import { cleanupOldRestoreData, restoreBackup } from './core/backup.ts';
import {
  openDatabase,
  closeDatabase,
  resolveDbPath,
  getAllKeyValues,
  migrateUnencryptedKeys,
  syncDocs,
  watchDocs,
} from './db/index.ts';
import { addSecrets, VAULT_SECRET_MIN_LENGTH } from './core/redact.ts';
import { ensureVaultKey } from './core/crypto.ts';
import { startWorker, clearHandlers } from './jobs.ts';
import type { BirdDisabledEvent } from './jobs.ts';
import { startScheduler } from './cron/scheduler.ts';
import { createSlackChannel } from './channel/slack.ts';
import { createWebChannel } from './channel/web.ts';
import type { WebChannel } from './channel/web.ts';
import { createWebServer, broadcastSSE } from './server/index.ts';
import type { WebServerDeps } from './server/index.ts';
import { startHealthChecks, getServiceHealth } from './server/health.ts';
import type { Config } from './core/types.ts';
import type { ChannelHandle } from './channel/types.ts';
import { resolve, dirname } from 'node:path';

const SHUTDOWN_TIMEOUT_MS = 5000;

interface DaemonOptions {
  flags: { verbose: boolean; config?: string; db?: string };
}

export async function startDaemon(options: DaemonOptions): Promise<void> {
  logger.setMode('daemon');
  process.stdout.write(BANNER + '\n\n');

  if (options.flags.verbose) {
    logger.setLevel('debug');
  }

  const configPath = resolve(
    options.flags.config ?? process.env['BROWSERBIRD_CONFIG'] ?? DEFAULT_CONFIG_PATH,
  );
  const configDir = dirname(configPath);
  const envPath = resolve(configDir, '.env');
  const dbPath = resolveDbPath(options.flags.db);

  let restartRequested = false;
  let pendingRestore: string | undefined;

  const runCycle = async (): Promise<boolean> => {
    const controller = new AbortController();

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

    const onSigint = () => shutdown('SIGINT');
    const onSigterm = () => shutdown('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    restartRequested = false;
    const requestRestart = (restoreName?: string) => {
      restartRequested = true;
      pendingRestore = restoreName;
      controller.abort();
    };

    cleanupOldRestoreData(configDir);
    openDatabase(dbPath);
    loadDotEnv(envPath);
    ensureVaultKey(envPath);
    migrateUnencryptedKeys();
    syncDocs();
    const stopDocWatcher = watchDocs(() => broadcastSSE('invalidate', { resource: 'docs' }));
    const vaultValues = getAllKeyValues();
    if (vaultValues.length > 0) addSecrets(vaultValues, VAULT_SECRET_MIN_LENGTH);
    clearBrowserLock();
    let currentConfig: Config;
    let slackHandle: ChannelHandle | null = null;
    let webChannel: WebChannel | null = null;

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

    const onBirdDisabled = (event: BirdDisabledEvent) => {
      if (event.channelId && slackHandle) {
        const text = `Bird "${event.name}" disabled after ${event.failureCount} consecutive failures.`;
        slackHandle.postMessage(event.channelId, text).catch(() => {});
      }
    };

    startWorker(controller.signal, {
      maxConsecutiveFailures: () => currentConfig.birds.maxConsecutiveFailures,
      onBirdDisabled,
    });

    const getConfig = (): Config => currentConfig;
    const getDeps = (): WebServerDeps => ({
      slackConnected: () => slackHandle?.isConnected() ?? false,
      activeProcessCount: () =>
        (slackHandle?.activeCount() ?? 0) + (webChannel?.activeCount() ?? 0),
      serviceHealth: () => getServiceHealth(currentConfig),
      webChannel: () => webChannel,
    });

    let activated = false;

    const activateLayers = (config: Config) => {
      currentConfig = config;

      if (!schedulerStarted && config.agents.length > 0) {
        logger.info('starting scheduler...');
        startScheduler(getConfig, controller.signal, {
          postToSlack: (channel, text, opts) =>
            slackHandle ? slackHandle.postMessage(channel, text, opts) : Promise.resolve(''),
          setThreadTitle: (channelId, threadTs, title) =>
            slackHandle ? slackHandle.setTitle(channelId, threadTs, title) : Promise.resolve(),
        });
        schedulerStarted = true;
      }

      if (!healthStarted) {
        startHealthChecks(getConfig, controller.signal);
        healthStarted = true;
      }

      if (!webChannel) {
        webChannel = createWebChannel(getConfig, controller.signal);
        logger.info('web chat enabled');
      }

      const hasSlackTokens =
        typeof config.slack.botToken === 'string' &&
        config.slack.botToken.startsWith('xoxb-') &&
        typeof config.slack.appToken === 'string' &&
        config.slack.appToken.startsWith('xapp-');
      if (!slackStarted && hasSlackTokens) {
        logger.info('connecting to slack...');
        slackHandle = createSlackChannel(getConfig, controller.signal);
        slackStarted = true;
        slackHandle.start().catch((err: unknown) => {
          logger.error(
            `slack failed to start: ${err instanceof Error ? err.message : String(err)}`,
          );
          slackStarted = false;
          slackHandle = null;
        });
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
      if (slackHandle) {
        slackHandle.resolveChannelNames().catch((err: unknown) => {
          logger.warn(
            `failed to resolve channel names on reload: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
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
        onRestart: requestRestart,
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
    stopDocWatcher();
    closeDatabase();
    clearHandlers();

    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);

    return restartRequested;
  };

  let shouldRestart = await runCycle();
  while (shouldRestart) {
    if (pendingRestore) {
      logger.info(`restoring backup "${pendingRestore}"...`);
      try {
        restoreBackup(configDir, pendingRestore);
      } catch (err) {
        logger.error(`restore failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      pendingRestore = undefined;
    }
    logger.info('restarting daemon...');
    shouldRestart = await runCycle();
  }

  logger.info('browserbird stopped');
}

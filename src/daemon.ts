/** @fileoverview Main orchestrator process — starts all subsystems and handles graceful shutdown. */

import type { CliOptions, Config } from './core/types.ts';
import { logger } from './core/logger.ts';
import { loadConfig } from './config.ts';
import {
  openDatabase,
  closeDatabase,
  deleteOldMessages,
  deleteOldCronRuns,
  deleteOldLogs,
  optimizeDatabase,
} from './db.ts';
import { expireStaleSessions } from './provider/session.ts';
import { startWorker } from './jobs.ts';
import { startScheduler } from './cron/scheduler.ts';
import { createSlackChannel } from './channel/slack.ts';
import { createWebServer } from './server.ts';
import { resolve } from 'node:path';

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

/** Periodically cleans up expired sessions, old messages, and cron runs. */
function startCleanupTask(config: Config, retentionDays: number): void {
  const cleanupIntervalMs = 60 * 60 * 1000;
  const optimizeIntervalMs = config.database.optimizeIntervalHours * 60 * 60 * 1000;

  const cleanup = () => {
    if (controller.signal.aborted) return;
    expireStaleSessions(config.sessions.ttlHours);
    const msgs = deleteOldMessages(retentionDays);
    const runs = deleteOldCronRuns(retentionDays);
    const errs = deleteOldLogs(retentionDays);
    if (msgs > 0 || runs > 0 || errs > 0) {
      logger.info(
        `cleanup: ${msgs} messages, ${runs} cron runs, ${errs} logs older than ${retentionDays}d`,
      );
    }
  };

  const optimize = () => {
    if (controller.signal.aborted) return;
    optimizeDatabase();
    logger.debug('database optimized');
  };

  cleanup();
  const cleanupTimer = setInterval(cleanup, cleanupIntervalMs);
  const optimizeTimer = setInterval(optimize, optimizeIntervalMs);

  controller.signal.addEventListener('abort', () => {
    clearInterval(cleanupTimer);
    clearInterval(optimizeTimer);
  });
}

export async function startDaemon(options: CliOptions): Promise<void> {
  setupShutdown();

  if (options.flags.verbose) {
    logger.setLevel('debug');
  }

  const config = loadConfig(options.flags.config);

  const envMcpConfigPath = process.env['BROWSERBIRD_MCP_CONFIG_PATH'];
  if (envMcpConfigPath != null) {
    config.browser.mcpConfigPath = envMcpConfigPath;
  }

  if (!config.slack.botToken) {
    throw new Error(
      'slack.botToken is required (set SLACK_BOT_TOKEN or configure in browserbird.json)',
    );
  }
  if (!config.slack.appToken) {
    throw new Error(
      'slack.appToken is required (set SLACK_APP_TOKEN or configure in browserbird.json)',
    );
  }

  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);

  const envDays = process.env['BROWSERBIRD_RETENTION_DAYS'];
  const retentionDays = envDays != null ? Number(envDays) : config.database.retentionDays;

  startCleanupTask(config, retentionDays);
  startWorker(controller.signal, retentionDays);

  const slackApp = createSlackChannel(config, controller.signal);

  if (config.cron.enabled) {
    startScheduler(config, controller.signal, {
      postToSlack: (channel, text) => slackApp.postMessage(channel, text),
    });
  }

  // Don't await Slack — Socket Mode retries indefinitely with back-off,
  // which would block the web server and everything else from starting.
  slackApp.start().catch((err: unknown) => {
    logger.error(`slack failed to start: ${err instanceof Error ? err.message : String(err)}`);
  });

  let webServer: Awaited<ReturnType<typeof createWebServer>> | null = null;
  if (config.web.enabled) {
    webServer = createWebServer(config, controller.signal, {
      slackConnected: () => slackApp.isConnected(),
    });
    await webServer.start();
  }

  logger.success('browserbird orchestrator started');
  logger.info(`agents: ${config.agents.map((a) => a.id).join(', ')}`);
  logger.info(`max concurrent sessions: ${config.sessions.maxConcurrent}`);

  await new Promise<void>((resolve) => {
    controller.signal.addEventListener('abort', () => {
      resolve();
    });
  });

  if (webServer) await webServer.stop();
  await Promise.race([slackApp.stop(), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
  closeDatabase();
  logger.info('browserbird stopped');
}

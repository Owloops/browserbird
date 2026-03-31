/** @fileoverview Cron scheduler: evaluates cron jobs every 60s and enqueues due jobs. */

import type { Config } from '../core/types.ts';
import type { CronSchedule } from './parse.ts';
import type { ChannelClient } from '../channel/types.ts';

import { logger } from '../core/logger.ts';
import { shortUid } from '../core/uid.ts';
import {
  SYSTEM_CRON_PREFIX,
  getEnabledCronJobs,
  updateCronJobStatus,
  setCronJobEnabled,
  ensureSystemCronJob,
  ensureBirdDataDir,
  hasPendingCronJob,
  deleteOldMessages,
  deleteOldCronRuns,
  deleteOldJobs,
  deleteOldLogs,
  optimizeDatabase,
  logMessage,
} from '../db/index.ts';
import { deleteExpiredSessions } from '../provider/session.ts';
import { registerHandler, enqueue } from '../jobs.ts';
import { broadcastSSE } from '../server/index.ts';
import { createBackup, enforceRetention } from '../core/backup.ts';
import { dirname } from 'node:path';
import { resolveDbPath } from '../db/path.ts';
import { spawnProvider } from '../provider/spawn.ts';
import { resolveExtraEnv } from '../db/keys.ts';
import { getDocsSystemPrompt } from '../db/docs.ts';
import { redact } from '../core/redact.ts';
import { parseCron, matchesCron, isWithinActiveHours } from './parse.ts';
import { streamToChannel, BROWSER_TOOL_PREFIX } from '../channel/stream.ts';
import { acquireBrowserLockWithHeartbeat } from '../browser/lock.ts';
import type { BrowserLockHandle } from '../browser/lock.ts';
import { getBrowserMode } from '../config.ts';

const activeKills = new Map<string, () => void>();

export function killBird(cronJobUid: string): boolean {
  const kill = activeKills.get(cronJobUid);
  if (!kill) return false;
  kill();
  activeKills.delete(cronJobUid);
  return true;
}

export function getRunningBirdUids(): string[] {
  return [...activeKills.keys()];
}

const TICK_INTERVAL_MS = 60_000;
const MAX_SCHEDULE_ERRORS = 3;

interface CronRunPayload {
  cronJobUid: string;
  birdName: string;
  prompt: string;
  channelId: string | null;
  agentId: string;
}

interface SystemCronPayload {
  cronJobUid: string;
  cronName: string;
}

export interface SchedulerDeps {
  channelClient?: () => ChannelClient | undefined;
  teamId?: () => string;
  botUserId?: () => string;
}

type SystemCronHandler = () => string | void;

const systemHandlers = new Map<string, SystemCronHandler>();

function registerSystemCronJobs(getConfig: () => Config): void {
  const cleanupName = `${SYSTEM_CRON_PREFIX}db_cleanup__`;
  const optimizeName = `${SYSTEM_CRON_PREFIX}db_optimize__`;
  const backupName = `${SYSTEM_CRON_PREFIX}auto_backup__`;

  systemHandlers.set(cleanupName, () => {
    const retentionDays = getConfig().database.retentionDays;
    const sessions = deleteExpiredSessions(retentionDays);
    const msgs = deleteOldMessages(retentionDays);
    const runs = deleteOldCronRuns(retentionDays);
    const jobs = deleteOldJobs(retentionDays);
    const logs = deleteOldLogs(retentionDays);
    if (sessions > 0 || msgs > 0 || runs > 0 || jobs > 0 || logs > 0) {
      const summary = `${sessions} sessions, ${msgs} messages, ${runs} flight logs, ${jobs} jobs, ${logs} logs older than ${retentionDays}d`;
      logger.info(`system cleanup: ${summary}`);
      return summary;
    }
    return 'nothing to clean';
  });

  systemHandlers.set(optimizeName, () => {
    optimizeDatabase();
    logger.debug('system optimize: database optimized');
    return 'database optimized';
  });

  const dataDir = dirname(resolveDbPath());
  systemHandlers.set(backupName, () => {
    const config = getConfig();
    if (config.database.backups?.auto === false) {
      return 'auto backup disabled';
    }
    const maxCount = config.database.backups?.maxCount ?? 10;
    const info = createBackup(dataDir);
    enforceRetention(dataDir, maxCount);
    broadcastSSE('invalidate', { resource: 'backups' });
    logger.info(`auto backup: ${info.name} (${info.size} bytes)`);
    return info.name;
  });

  ensureSystemCronJob(cleanupName, '0 */6 * * *', 'Database cleanup');
  ensureSystemCronJob(optimizeName, '0 3 * * *', 'Database optimization');
  ensureSystemCronJob(backupName, '0 2 * * *', 'Automatic backup');
  logger.info('system birds registered');
}

/** Registers the cron_run job handler and starts the scheduler tick loop. */
export function startScheduler(
  getConfig: () => Config,
  signal: AbortSignal,
  deps?: SchedulerDeps,
): void {
  registerSystemCronJobs(getConfig);

  registerHandler('cron_run', async (raw) => {
    const payload = raw as CronRunPayload;
    const config = getConfig();
    const agent = config.agents.find((a) => a.id === payload.agentId);
    if (!agent) {
      throw new Error(`agent "${payload.agentId}" not found`);
    }

    const needsBrowserLock = config.browser.enabled && getBrowserMode() === 'persistent';
    let browserLock: BrowserLockHandle | null = null;

    try {
      const targets: Array<{ type: 'channel' | 'bird'; id: string }> = [];
      if (payload.channelId) targets.push({ type: 'channel', id: payload.channelId });
      targets.push({ type: 'bird', id: payload.cronJobUid });
      const extraEnv = resolveExtraEnv(targets) ?? {};
      extraEnv['BROWSERBIRD_BIRD_DATA'] = ensureBirdDataDir(payload.cronJobUid);

      const { events, kill } = spawnProvider(
        {
          message: payload.prompt,
          agent,
          mcpConfigPath: config.browser.mcpConfigPath,
          timezone: config.timezone,
          globalTimeoutMs: config.sessions.processTimeoutMs,
          extraEnv,
          docsPrompt: getDocsSystemPrompt(targets),
        },
        signal,
      );
      activeKills.set(payload.cronJobUid, kill);

      if (payload.channelId) {
        logMessage(payload.channelId, null, agent.id, 'in', payload.prompt);
      }

      const client = deps?.channelClient?.();
      const canStream = payload.channelId && client && deps?.teamId && deps?.botUserId;

      if (canStream) {
        const threadTs = await client.postMessage(
          payload.channelId!,
          '',
          `_Running ${payload.birdName}..._`,
        );

        const title = `${payload.birdName}: ${payload.prompt.slice(0, 60)}`;
        client.setTitle?.(payload.channelId!, threadTs, title).catch(() => {});

        const onToolUse = (toolName: string) => {
          if (!needsBrowserLock || browserLock) return;
          if (!toolName.startsWith(BROWSER_TOOL_PREFIX)) return;
          browserLock = acquireBrowserLockWithHeartbeat(
            payload.cronJobUid,
            config.sessions.processTimeoutMs,
          );
          if (!browserLock) throw new Error('browser is locked by another session');
          logger.info(`browser lock acquired lazily for bird ${shortUid(payload.cronJobUid)}`);
        };

        const { fullText, error } = await streamToChannel(
          client,
          signal,
          events,
          {
            channelId: payload.channelId!,
            threadTs,
            teamId: deps!.teamId!(),
            userId: deps!.botUserId!(),
          },
          { birdName: agent.name, onToolUse },
          {
            onCompletion: (text, comp) => {
              logMessage(
                payload.channelId!,
                threadTs,
                agent.id,
                'out',
                text || undefined,
                comp.tokensIn,
                comp.tokensOut,
              );
            },
          },
        );

        if (error) {
          throw new Error(error);
        }

        logger.info(`bird ${shortUid(payload.cronJobUid)} streamed to ${payload.channelId}`);
        return fullText || 'completed (no output)';
      }

      let result = '';
      for await (const event of events) {
        if (event.type === 'tool_use') {
          if (needsBrowserLock && !browserLock && event.toolName.startsWith(BROWSER_TOOL_PREFIX)) {
            browserLock = acquireBrowserLockWithHeartbeat(
              payload.cronJobUid,
              config.sessions.processTimeoutMs,
            );
            if (!browserLock) throw new Error('browser is locked by another session');
            logger.info(`browser lock acquired lazily for bird ${shortUid(payload.cronJobUid)}`);
          }
        } else if (event.type === 'text_delta') {
          result += redact(event.delta);
        } else if (event.type === 'error') {
          throw new Error(redact(event.error));
        }
      }

      logger.info(
        `bird ${shortUid(payload.cronJobUid)} completed (${result.length} chars, no channel)`,
      );
      return result || 'completed (no output)';
    } finally {
      activeKills.delete(payload.cronJobUid);
      browserLock?.release();
    }
  });

  registerHandler('system_cron_run', (raw) => {
    const payload = raw as SystemCronPayload;
    const handler = systemHandlers.get(payload.cronName);
    if (!handler) {
      throw new Error(`no system handler for "${payload.cronName}"`);
    }
    const result = handler();
    logger.info(`${payload.cronName}: ${result ?? 'done'}`);
    return result ?? undefined;
  });

  const scheduleCache = new Map<string, CronSchedule>();
  const scheduleErrors = new Map<string, number>();

  const tick = () => {
    if (signal.aborted) return;

    const config = getConfig();
    const now = new Date();
    const jobs = getEnabledCronJobs();

    for (const job of jobs) {
      let schedule = scheduleCache.get(job.uid);
      if (!schedule) {
        try {
          schedule = parseCron(job.schedule);
          scheduleCache.set(job.uid, schedule);
          scheduleErrors.delete(job.uid);
        } catch {
          const count = (scheduleErrors.get(job.uid) ?? 0) + 1;
          scheduleErrors.set(job.uid, count);
          if (count >= MAX_SCHEDULE_ERRORS) {
            logger.warn(
              `bird ${shortUid(job.uid)}: invalid expression "${job.schedule}" (${count} consecutive failures), disabling`,
            );
            setCronJobEnabled(job.uid, false);
            scheduleErrors.delete(job.uid);
          } else {
            logger.warn(
              `bird ${shortUid(job.uid)}: invalid expression "${job.schedule}" (attempt ${count}/${MAX_SCHEDULE_ERRORS})`,
            );
          }
          continue;
        }
      }

      if (!matchesCron(schedule, now, config.timezone)) continue;

      if (
        !isWithinActiveHours(job.active_hours_start, job.active_hours_end, now, config.timezone)
      ) {
        logger.debug(`bird ${shortUid(job.uid)} skipped: outside active hours`);
        continue;
      }

      if (hasPendingCronJob(job.uid)) {
        logger.debug(`bird ${shortUid(job.uid)} skipped: previous run still pending or running`);
        continue;
      }

      const isSystem = job.name.startsWith(SYSTEM_CRON_PREFIX);

      logger.info(`bird ${shortUid(job.uid)} triggered: "${job.schedule}"`);

      if (isSystem) {
        enqueue(
          'system_cron_run',
          { cronJobUid: job.uid, cronName: job.name } satisfies SystemCronPayload,
          { maxAttempts: 3, timeout: 300, cronJobUid: job.uid },
        );
      } else {
        enqueue(
          'cron_run',
          {
            cronJobUid: job.uid,
            birdName: job.name,
            prompt: job.prompt,
            channelId: job.target_channel_id,
            agentId: job.agent_id,
          } satisfies CronRunPayload,
          {
            maxAttempts: config.birds.maxAttempts,
            timeout: 600,
            cronJobUid: job.uid,
          },
        );
      }

      updateCronJobStatus(job.uid, 'triggered', job.failure_count);
      broadcastSSE('invalidate', { resource: 'birds', cronJobUid: job.uid });
    }
  };

  tick();
  const timer = setInterval(tick, TICK_INTERVAL_MS);

  signal.addEventListener('abort', () => {
    clearInterval(timer);
    scheduleCache.clear();
    scheduleErrors.clear();
    activeKills.clear();
  });

  logger.info('bird scheduler started (60s tick)');
}

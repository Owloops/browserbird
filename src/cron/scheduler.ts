/** @fileoverview Cron scheduler: evaluates cron jobs every 60s and enqueues due jobs. */

import type { Config } from '../core/types.ts';
import type { Block } from '../channel/blocks.ts';
import type { CronSchedule } from './parse.ts';
import type { StreamEventCompletion } from '../provider/stream.ts';

import { logger } from '../core/logger.ts';
import { shortUid } from '../core/uid.ts';
import {
  SYSTEM_CRON_PREFIX,
  getEnabledCronJobs,
  updateCronJobStatus,
  setCronJobEnabled,
  ensureSystemCronJob,
  hasPendingCronJob,
  deleteOldMessages,
  deleteOldCronRuns,
  deleteOldJobs,
  deleteOldLogs,
  optimizeDatabase,
  logMessage,
} from '../db/index.ts';
import { expireStaleSessions } from '../provider/session.ts';
import { registerHandler, enqueue } from '../jobs.ts';
import { broadcastSSE } from '../server/index.ts';
import { spawnProvider } from '../provider/spawn.ts';
import { redact } from '../core/redact.ts';
import { parseCron, matchesCron, isWithinActiveHours } from './parse.ts';
import { sessionCompleteBlocks, sessionErrorBlocks } from '../channel/blocks.ts';
import { acquireBrowserLockWithHeartbeat } from '../browser/lock.ts';
import type { BrowserLockHandle } from '../browser/lock.ts';
import { getBrowserMode } from '../config.ts';

const BROWSER_TOOL_PREFIX = 'mcp__playwright__';

const TICK_INTERVAL_MS = 60_000;
const MAX_SCHEDULE_ERRORS = 3;

interface CronRunPayload {
  cronJobUid: string;
  prompt: string;
  channelId: string | null;
  agentId: string;
}

interface SystemCronPayload {
  cronJobUid: string;
  cronName: string;
}

export interface SchedulerDeps {
  postToSlack?: (channel: string, text: string, opts?: { blocks?: Block[] }) => Promise<void>;
}

type SystemCronHandler = () => string | void;

const systemHandlers = new Map<string, SystemCronHandler>();

function registerSystemCronJobs(config: Config, retentionDays: number): void {
  const cleanupName = `${SYSTEM_CRON_PREFIX}db_cleanup__`;
  const optimizeName = `${SYSTEM_CRON_PREFIX}db_optimize__`;

  systemHandlers.set(cleanupName, () => {
    expireStaleSessions(config.sessions.ttlHours);
    const msgs = deleteOldMessages(retentionDays);
    const runs = deleteOldCronRuns(retentionDays);
    const jobs = deleteOldJobs(retentionDays);
    const logs = deleteOldLogs(retentionDays);
    if (msgs > 0 || runs > 0 || jobs > 0 || logs > 0) {
      const summary = `${msgs} messages, ${runs} flight logs, ${jobs} jobs, ${logs} logs older than ${retentionDays}d`;
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

  ensureSystemCronJob(cleanupName, '0 */6 * * *', 'Database cleanup');
  ensureSystemCronJob(optimizeName, '0 3 * * *', 'Database optimization');
  logger.info('system birds registered');
}

/** Registers the cron_run job handler and starts the scheduler tick loop. */
export function startScheduler(
  getConfig: () => Config,
  signal: AbortSignal,
  deps?: SchedulerDeps,
): void {
  const initialConfig = getConfig();
  registerSystemCronJobs(initialConfig, initialConfig.database.retentionDays);

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
      const { events } = spawnProvider(
        agent.provider,
        {
          message: payload.prompt,
          agent,
          mcpConfigPath: config.browser.mcpConfigPath,
          timezone: config.timezone,
          globalTimeoutMs: config.sessions.processTimeoutMs,
        },
        signal,
      );

      if (payload.channelId) {
        logMessage(payload.channelId, null, agent.id, 'in', payload.prompt);
      }

      let result = '';
      let completion: StreamEventCompletion | undefined;
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
        } else if (event.type === 'completion') {
          completion = event;
        } else if (event.type === 'rate_limit') {
          logger.debug(
            `bird ${shortUid(payload.cronJobUid)} rate limit window resets ${new Date(event.resetsAt * 1000).toISOString()}`,
          );
        } else if (event.type === 'error') {
          const safeError = redact(event.error);
          if (payload.channelId && deps?.postToSlack) {
            const blocks = sessionErrorBlocks(safeError, { birdName: agent.name });
            await deps.postToSlack(payload.channelId, `Bird failed: ${safeError}`, { blocks });
          }
          throw new Error(safeError);
        }
      }

      if (completion && payload.channelId) {
        logMessage(
          payload.channelId,
          null,
          agent.id,
          'out',
          result || undefined,
          completion.tokensIn,
          completion.tokensOut,
        );
      }

      if (!result) {
        logger.info(`bird ${shortUid(payload.cronJobUid)} completed (no output)`);
        return 'completed (no output)';
      }

      if (payload.channelId && deps?.postToSlack) {
        await deps.postToSlack(payload.channelId, result);
        if (completion) {
          const blocks = sessionCompleteBlocks(completion, undefined, agent.name);
          const fallback = `Bird ${agent.name} completed: ${completion.numTurns} turns`;
          await deps.postToSlack(payload.channelId, fallback, { blocks });
        }
        logger.info(`bird ${shortUid(payload.cronJobUid)} result posted to ${payload.channelId}`);
      } else {
        logger.info(`bird ${shortUid(payload.cronJobUid)} completed (${result.length} chars)`);
      }

      return result;
    } finally {
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
  });

  logger.info('bird scheduler started (60s tick)');
}

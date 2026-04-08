/** @fileoverview Background job queue with handler registry, polling worker, and retry logic. */

import type { CreateJobOptions, JobRow, JobPriority } from './db/index.ts';
import {
  createJob,
  claimNextJob,
  completeJob,
  failJob,
  failStaleJobs,
  getJobStatus,
  insertLog,
  updateCronJobStatus,
  getCronJob,
  createCronRun,
  completeCronRun,
} from './db/index.ts';
import { logger } from './core/logger.ts';
import { shortUid } from './core/uid.ts';
import { broadcastSSE } from './server/index.ts';

type JobHandler = (payload: unknown) => Promise<string | void> | string | void;

export interface BirdDisabledEvent {
  cronJobUid: string;
  name: string;
  failureCount: number;
  channelId: string | null;
}

type BirdDisabledCallback = (event: BirdDisabledEvent) => void;

const handlers = new Map<string, JobHandler>();
let onBirdDisabledCb: BirdDisabledCallback | undefined;
let getMaxConsecutiveFailures = (): number => 0;

const POLL_INTERVAL_MS = 1000;
const STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function registerHandler(name: string, handler: JobHandler): void {
  handlers.set(name, handler);
}

export function clearHandlers(): void {
  handlers.clear();
}

export interface QueueOptions {
  priority?: JobPriority;
  maxAttempts?: number;
  timeout?: number;
  delaySeconds?: number;
  cronJobUid?: string;
}

export function enqueue(name: string, payload?: unknown, options?: QueueOptions): JobRow {
  const jobOptions: CreateJobOptions = {
    name,
    payload,
    priority: options?.priority,
    maxAttempts: options?.maxAttempts,
    timeout: options?.timeout,
    delaySeconds: options?.delaySeconds,
    cronJobUid: options?.cronJobUid,
  };
  const job = createJob(jobOptions);
  logger.debug(`enqueued job ${job.id}: ${name}`);
  return job;
}

async function processJob(job: JobRow): Promise<void> {
  const handler = handlers.get(job.name);
  if (!handler) {
    failJob(job.id, `no handler registered for "${job.name}"`);
    logger.warn(`job ${job.id}: no handler for "${job.name}"`);
    return;
  }

  const isCronRun = job.cron_job_uid != null;
  const cronRun = isCronRun ? createCronRun(job.cron_job_uid!) : null;

  let finalStatus = 'completed';
  let resultText: string | undefined;
  let errorText: string | undefined;
  try {
    const payload = job.payload ? (JSON.parse(job.payload) as unknown) : undefined;
    const result = await handler(payload);
    resultText = typeof result === 'string' ? result : undefined;
    completeJob(job.id, resultText);
    logger.debug(`job ${job.id} completed: ${job.name}`);
  } catch (err) {
    finalStatus = 'failed';
    errorText = err instanceof Error ? err.message : String(err);
    failJob(job.id, errorText);
    logger.warn(`job ${job.id} failed (attempt ${job.attempts}/${job.max_attempts}): ${errorText}`);
    insertLog('error', 'cron', errorText);
  } finally {
    if (cronRun != null) {
      completeCronRun(
        cronRun.uid,
        finalStatus === 'completed' ? 'success' : 'error',
        resultText,
        errorText,
      );
    }
    if (isCronRun && job.cron_job_uid != null) {
      const currentStatus = getJobStatus(job.id);
      const alreadyHandled = currentStatus === 'failed' && finalStatus === 'failed';
      if (!alreadyHandled) {
        const cronJob = getCronJob(job.cron_job_uid);
        if (cronJob != null) {
          const newFailureCount = finalStatus === 'failed' ? cronJob.failure_count + 1 : 0;
          const shouldDisable =
            newFailureCount > 0 &&
            getMaxConsecutiveFailures() > 0 &&
            newFailureCount >= getMaxConsecutiveFailures();
          updateCronJobStatus(
            job.cron_job_uid,
            finalStatus,
            newFailureCount,
            shouldDisable ? false : undefined,
          );

          if (shouldDisable) {
            logger.warn(
              `bird ${shortUid(job.cron_job_uid)} disabled after ${newFailureCount} consecutive failures`,
            );

            onBirdDisabledCb?.({
              cronJobUid: job.cron_job_uid,
              name: cronJob.name,
              failureCount: newFailureCount,
              channelId: cronJob.target_channel_id,
            });
          }
        }
      }
    }
    const resource = isCronRun ? 'birds' : 'sessions';
    const invalidatePayload: { resource: string; cronJobUid?: string } = { resource };
    if (job.cron_job_uid != null) invalidatePayload.cronJobUid = job.cron_job_uid;
    broadcastSSE('invalidate', invalidatePayload);
  }
}

export interface WorkerOptions {
  maxConsecutiveFailures?: () => number;
  onBirdDisabled?: BirdDisabledCallback;
}

/**
 * Starts the job worker loop. Polls for pending jobs, processes them one at a time.
 * Checks for stale running jobs every 5 minutes.
 */
export function startWorker(signal: AbortSignal, options?: WorkerOptions): void {
  getMaxConsecutiveFailures = options?.maxConsecutiveFailures ?? (() => 0);
  onBirdDisabledCb = options?.onBirdDisabled;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const pollTick = async () => {
    if (signal.aborted) return;

    try {
      const job = claimNextJob([...handlers.keys()]);
      if (job) {
        logger.debug(`worker claimed job ${job.id}: ${job.name}`);
        await processJob(job);
        if (!signal.aborted) pollTick();
        return;
      }
    } catch (err) {
      logger.error(`worker poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!signal.aborted) {
      pollTimer = setTimeout(pollTick, POLL_INTERVAL_MS);
    }
  };

  const staleCheck = () => {
    if (signal.aborted) return;
    const stale = failStaleJobs();
    if (stale > 0) {
      logger.info(`timed out ${stale} stale job(s)`);
    }
  };

  staleCheck();
  const staleTimer = setInterval(staleCheck, STALE_CHECK_INTERVAL_MS);

  signal.addEventListener('abort', () => {
    if (pollTimer) clearTimeout(pollTimer);
    clearInterval(staleTimer);
  });

  pollTick();
}

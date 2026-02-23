/** @fileoverview Background job queue with handler registry, polling worker, and retry logic. */

import type { CreateJobOptions, JobRow, JobPriority } from './db/index.ts';
import {
  createJob,
  claimNextJob,
  completeJob,
  failJob,
  failStaleJobs,
  deleteOldJobs,
  insertLog,
  updateCronJobStatus,
  getCronJob,
  createCronRun,
  completeCronRun,
} from './db/index.ts';
import { logger } from './core/logger.ts';
import { recordError } from './core/metrics.ts';
import { broadcastSSE } from './server/index.ts';

type JobHandler = (payload: unknown) => Promise<string | void> | string | void;

const handlers = new Map<string, JobHandler>();

const POLL_INTERVAL_MS = 1000;
const STALE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function registerHandler(name: string, handler: JobHandler): void {
  handlers.set(name, handler);
}

export interface QueueOptions {
  priority?: JobPriority;
  maxAttempts?: number;
  timeout?: number;
  delaySeconds?: number;
  cronJobId?: number;
}

export function enqueue(name: string, payload?: unknown, options?: QueueOptions): JobRow {
  const jobOptions: CreateJobOptions = {
    name,
    payload,
    priority: options?.priority,
    maxAttempts: options?.maxAttempts,
    timeout: options?.timeout,
    delaySeconds: options?.delaySeconds,
    cronJobId: options?.cronJobId,
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

  const isCronRun = job.cron_job_id != null;
  const cronRun = isCronRun ? createCronRun(job.cron_job_id!) : null;

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
    recordError('cron');
    insertLog('error', 'cron', errorText);
  } finally {
    if (cronRun != null) {
      completeCronRun(
        cronRun.id,
        finalStatus === 'completed' ? 'success' : 'error',
        resultText,
        errorText,
      );
    }
    if (isCronRun && job.cron_job_id != null) {
      const cronJob = getCronJob(job.cron_job_id);
      if (cronJob != null) {
        const newFailureCount =
          finalStatus === 'failed' ? cronJob.failure_count + 1 : cronJob.failure_count;
        updateCronJobStatus(job.cron_job_id, finalStatus, newFailureCount);
      }
    }
    const resource = isCronRun ? 'birds' : 'sessions';
    const invalidatePayload: { resource: string; cronJobId?: number } = { resource };
    if (job.cron_job_id != null) invalidatePayload.cronJobId = job.cron_job_id;
    broadcastSSE('invalidate', invalidatePayload);
  }
}

/**
 * Starts the job worker loop. Polls for pending jobs, processes them one at a time.
 * Checks for stale running jobs every 5 minutes.
 */
export function startWorker(signal: AbortSignal, retentionDays: number): void {
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const pollTick = async () => {
    if (signal.aborted) return;

    const job = claimNextJob();
    if (job) {
      await processJob(job);
      if (!signal.aborted) pollTick();
      return;
    }

    pollTimer = setTimeout(pollTick, POLL_INTERVAL_MS);
  };

  const staleCheck = () => {
    if (signal.aborted) return;
    const stale = failStaleJobs();
    if (stale > 0) {
      logger.info(`timed out ${stale} stale job(s)`);
    }
    const deleted = deleteOldJobs(retentionDays);
    if (deleted > 0) {
      logger.info(`cleaned up ${deleted} old job(s)`);
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

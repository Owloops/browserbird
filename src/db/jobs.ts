/** @fileoverview Work queue: persistent job scheduling and processing. */

import type { PaginatedResult } from './core.ts';
import { getDb, paginate, transaction, DEFAULT_PER_PAGE } from './core.ts';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JobPriority = 'high' | 'normal' | 'low';

export interface JobRow {
  id: number;
  name: string;
  payload: string | null;
  status: JobStatus;
  priority: JobPriority;
  attempts: number;
  max_attempts: number;
  timeout: number;
  cron_job_uid: string | null;
  run_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
}

export interface CreateJobOptions {
  name: string;
  payload?: unknown;
  priority?: JobPriority;
  maxAttempts?: number;
  timeout?: number;
  delaySeconds?: number;
  cronJobUid?: string;
}

export interface ListJobsFilters {
  status?: string;
  cronJobUid?: string;
  name?: string;
}

export interface JobStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

export function createJob(options: CreateJobOptions): JobRow {
  const payload = options.payload != null ? JSON.stringify(options.payload) : null;
  const priority = options.priority ?? 'normal';
  const maxAttempts = options.maxAttempts ?? 1;
  const timeout = options.timeout ?? 1800;
  const cronJobUid = options.cronJobUid ?? null;

  if (options.delaySeconds) {
    return getDb()
      .prepare(
        `INSERT INTO jobs (name, payload, priority, max_attempts, timeout, cron_job_uid, run_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))
         RETURNING *`,
      )
      .get(
        options.name,
        payload,
        priority,
        maxAttempts,
        timeout,
        cronJobUid,
        options.delaySeconds,
      ) as unknown as JobRow;
  }

  return getDb()
    .prepare(
      `INSERT INTO jobs (name, payload, priority, max_attempts, timeout, cron_job_uid)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(options.name, payload, priority, maxAttempts, timeout, cronJobUid) as unknown as JobRow;
}

/**
 * Atomically claims the next pending job for processing.
 * Uses IMMEDIATE transaction to prevent race conditions.
 * Priority order: high > normal > low, then by creation time.
 */
export function claimNextJob(): JobRow | undefined {
  return transaction(() => {
    const priorityOrder = `CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 END`;
    const row = getDb()
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'pending' AND (run_at IS NULL OR run_at <= datetime('now'))
         ORDER BY ${priorityOrder}, created_at ASC
         LIMIT 1`,
      )
      .get() as unknown as JobRow | undefined;

    if (!row) return undefined;

    getDb()
      .prepare(
        `UPDATE jobs SET status = 'running', started_at = datetime('now'), attempts = attempts + 1
         WHERE id = ?`,
      )
      .run(row.id);

    return { ...row, status: 'running' as const, attempts: row.attempts + 1 };
  });
}

export function getJobStatus(jobId: number): JobStatus | undefined {
  const row = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as unknown as
    | { status: JobStatus }
    | undefined;
  return row?.status;
}

export function completeJob(jobId: number, result?: string): void {
  getDb()
    .prepare(
      `UPDATE jobs SET status = 'completed', completed_at = datetime('now'), result = ?
       WHERE id = ?`,
    )
    .run(result ?? null, jobId);
}

export function failJob(jobId: number, error: string): void {
  const job = getDb()
    .prepare('SELECT attempts, max_attempts FROM jobs WHERE id = ?')
    .get(jobId) as unknown as { attempts: number; max_attempts: number } | undefined;

  if (!job) return;

  if (job.attempts < job.max_attempts) {
    const delaySeconds = job.attempts * job.attempts;
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'pending', error = ?,
         run_at = datetime('now', '+' || ? || ' seconds')
         WHERE id = ?`,
      )
      .run(error, delaySeconds, jobId);
  } else {
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'failed', completed_at = datetime('now'), error = ?
         WHERE id = ?`,
      )
      .run(error, jobId);
  }
}

/** Marks running jobs past their timeout as failed and cascades to linked cron_runs/cron_jobs. */
export function failStaleJobs(): number {
  const d = getDb();

  const staleRows = d
    .prepare(
      `SELECT id, cron_job_uid FROM jobs
       WHERE status = 'running'
         AND started_at < datetime('now', '-' || timeout || ' seconds')`,
    )
    .all() as unknown as Array<{ id: number; cron_job_uid: string | null }>;

  if (staleRows.length === 0) return 0;

  const updateJob = d.prepare(
    `UPDATE jobs SET status = 'failed', error = 'timeout', completed_at = datetime('now')
     WHERE id = ?`,
  );
  const updateRun = d.prepare(
    `UPDATE cron_runs SET status = 'error', error = 'timeout', finished_at = datetime('now')
     WHERE job_uid = ? AND status = 'running'`,
  );
  const updateBird = d.prepare(
    `UPDATE cron_jobs SET last_status = 'failed', failure_count = failure_count + 1
     WHERE uid = ?`,
  );

  for (const row of staleRows) {
    updateJob.run(row.id);
    if (row.cron_job_uid != null) {
      updateRun.run(row.cron_job_uid);
      updateBird.run(row.cron_job_uid);
    }
  }

  return staleRows.length;
}

export function deleteOldJobs(retentionDays: number): number {
  const stmt = getDb().prepare(
    `DELETE FROM jobs WHERE status IN ('completed', 'failed')
     AND completed_at < datetime('now', ? || ' days')`,
  );
  return Number(stmt.run(`-${retentionDays}`).changes);
}

const JOB_SORT_COLUMNS = new Set(['id', 'name', 'status', 'priority', 'created_at', 'started_at']);
const JOB_SEARCH_COLUMNS = ['name', 'error'] as const;

export function listJobs(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  filters: ListJobsFilters = {},
  sort?: string,
  search?: string,
): PaginatedResult<JobRow> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.cronJobUid != null) {
    conditions.push('cron_job_uid = ?');
    params.push(filters.cronJobUid);
  }
  if (filters.name) {
    conditions.push('name LIKE ?');
    params.push(`%${filters.name}%`);
  }

  const where = conditions.join(' AND ');
  return paginate<JobRow>('jobs', page, perPage, {
    where,
    params,
    defaultSort: 'created_at DESC',
    sort,
    search,
    allowedSortColumns: JOB_SORT_COLUMNS,
    searchColumns: JOB_SEARCH_COLUMNS,
  });
}

export function getJobStats(): JobStats {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) as count FROM jobs GROUP BY status')
    .all() as unknown as Array<{ status: string; count: number }>;

  const stats: JobStats = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
  for (const row of rows) {
    if (row.status in stats) {
      (stats as unknown as Record<string, number>)[row.status] = row.count;
    }
    stats.total += row.count;
  }
  return stats;
}

export function retryJob(jobId: number): boolean {
  const result = getDb()
    .prepare(
      `UPDATE jobs SET status = 'pending', attempts = 0, error = NULL, result = NULL,
       run_at = NULL, started_at = NULL, completed_at = NULL
       WHERE id = ? AND status = 'failed'`,
    )
    .run(jobId);
  return Number(result.changes) > 0;
}

export function retryAllFailedJobs(): number {
  const result = getDb()
    .prepare(
      `UPDATE jobs SET status = 'pending', attempts = 0, error = NULL, result = NULL,
       run_at = NULL, started_at = NULL, completed_at = NULL
       WHERE status = 'failed'`,
    )
    .run();
  return Number(result.changes);
}

export function deleteJob(jobId: number): boolean {
  const result = getDb().prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  return Number(result.changes) > 0;
}

export function clearJobs(status: 'completed' | 'failed'): number {
  const result = getDb().prepare('DELETE FROM jobs WHERE status = ?').run(status);
  return Number(result.changes);
}

/** Returns true if the given cron job has a pending or running job in the queue. */
export function hasPendingCronJob(cronJobUid: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM jobs WHERE cron_job_uid = ? AND status IN ('pending', 'running') LIMIT 1`,
    )
    .get(cronJobUid) as unknown | undefined;
  return row != null;
}

/** @fileoverview SQLite database using node:sqlite. Migrations, typed queries. */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from './core/logger.ts';

export interface SessionRow {
  id: number;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  agent_id: string;
  provider_session_id: string;
  created_at: string;
  last_active: string;
  message_count: number;
}

export interface CronJobRow {
  id: number;
  name: string;
  agent_id: string;
  schedule: string;
  prompt: string;
  target_channel_id: string | null;
  active_hours_start: string | null;
  active_hours_end: string | null;
  timezone: string;
  enabled: number;
  failure_count: number;
  last_run: string | null;
  last_status: string | null;
  created_at: string;
}

export interface CronRunRow {
  id: number;
  job_id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  result: string | null;
  error: string | null;
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JobPriority = 'high' | 'normal' | 'low';

export const SYSTEM_CRON_PREFIX = '__bb_';

export interface JobRow {
  id: number;
  name: string;
  payload: string | null;
  status: JobStatus;
  priority: JobPriority;
  attempts: number;
  max_attempts: number;
  timeout: number;
  cron_job_id: number | null;
  run_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
}

export interface MessageRow {
  id: number;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  slack_user_id: string;
  direction: 'in' | 'out';
  content: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

function paginate<T>(
  table: string,
  page: number,
  perPage: number,
  where = '',
  params: (string | number)[] = [],
  orderBy = 'id DESC',
): PaginatedResult<T> {
  const pp = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
  const p = Math.max(page, 1);
  const offset = (p - 1) * pp;

  const countSql = `SELECT COUNT(*) as count FROM ${table}${where ? ` WHERE ${where}` : ''}`;
  const countRow = getDb()
    .prepare(countSql)
    .get(...params) as unknown as { count: number };
  const totalItems = countRow.count;
  const totalPages = Math.max(Math.ceil(totalItems / pp), 1);

  const dataSql = `SELECT * FROM ${table}${where ? ` WHERE ${where}` : ''} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  const items = getDb()
    .prepare(dataSql)
    .all(...params, pp, offset) as unknown as T[];

  return { items, page: p, perPage: pp, totalItems, totalPages };
}

interface Migration {
  name: string;
  up: (db: DatabaseSync) => void;
}

/**
 * Versioned migration registry. Each entry runs once, in order.
 * PRAGMA user_version tracks which migrations have been applied.
 * All DDL uses IF NOT EXISTS for idempotency.
 */
const MIGRATIONS: Migration[] = [
  {
    name: 'initial schema',
    up(d) {
      d.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY,
          slack_channel_id TEXT NOT NULL,
          slack_thread_ts TEXT,
          agent_id TEXT NOT NULL DEFAULT 'default',
          provider_session_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_active TEXT NOT NULL DEFAULT (datetime('now')),
          message_count INTEGER NOT NULL DEFAULT 0,
          UNIQUE(slack_channel_id, slack_thread_ts)
        );

        CREATE TABLE IF NOT EXISTS cron_jobs (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          agent_id TEXT NOT NULL DEFAULT 'default',
          schedule TEXT NOT NULL,
          prompt TEXT NOT NULL,
          target_channel_id TEXT,
          active_hours_start TEXT,
          active_hours_end TEXT,
          timezone TEXT DEFAULT 'UTC',
          enabled INTEGER NOT NULL DEFAULT 1,
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_run TEXT,
          last_status TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cron_runs (
          id INTEGER PRIMARY KEY,
          job_id INTEGER NOT NULL REFERENCES cron_jobs(id),
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT,
          status TEXT NOT NULL DEFAULT 'running',
          result TEXT,
          error TEXT
        );

        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY,
          slack_channel_id TEXT NOT NULL,
          slack_thread_ts TEXT,
          slack_user_id TEXT NOT NULL,
          direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
          content TEXT,
          tokens_in INTEGER,
          tokens_out INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS jobs (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          payload TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
          priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('high', 'normal', 'low')),
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 1,
          timeout INTEGER NOT NULL DEFAULT 1800,
          run_at TEXT,
          started_at TEXT,
          completed_at TEXT,
          result TEXT,
          error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY,
          level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('debug', 'info', 'warn', 'error')),
          source TEXT NOT NULL,
          message TEXT NOT NULL,
          channel_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_channel_thread
          ON sessions(slack_channel_id, slack_thread_ts);
        CREATE INDEX IF NOT EXISTS idx_sessions_last_active
          ON sessions(last_active);
        CREATE INDEX IF NOT EXISTS idx_messages_channel_thread
          ON messages(slack_channel_id, slack_thread_ts);
        CREATE INDEX IF NOT EXISTS idx_messages_created_at
          ON messages(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cron_runs_job_id
          ON cron_runs(job_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled
          ON cron_jobs(enabled);
        CREATE INDEX IF NOT EXISTS idx_jobs_poll
          ON jobs(status, priority, run_at, created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_stale
          ON jobs(status, started_at);
        CREATE INDEX IF NOT EXISTS idx_logs_created_at
          ON logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_logs_level_source
          ON logs(level, source, created_at DESC);
      `);
    },
  },
  {
    name: 'add cron_job_id to jobs',
    up(d) {
      d.exec(`
        ALTER TABLE jobs ADD COLUMN cron_job_id INTEGER REFERENCES cron_jobs(id);
        CREATE INDEX IF NOT EXISTS idx_jobs_cron_job_id ON jobs(cron_job_id);
      `);
    },
  },
];

let db: DatabaseSync | null = null;

function getSchemaVersion(d: DatabaseSync): number {
  const row = d.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
  return row.user_version;
}

function setSchemaVersion(d: DatabaseSync, version: number): void {
  d.exec(`PRAGMA user_version = ${version}`);
}

/**
 * Runs pending migrations inside a transaction.
 * Safe to call on every startup — already-applied migrations are skipped.
 */
function migrate(d: DatabaseSync): void {
  const current = getSchemaVersion(d);
  const target = MIGRATIONS.length;

  if (current >= target) return;

  for (let i = current; i < target; i++) {
    const migration = MIGRATIONS[i]!;
    logger.info(`migration ${i + 1}/${target}: ${migration.name}`);
    d.exec('BEGIN');
    try {
      migration.up(d);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw new Error(
        `migration "${migration.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    setSchemaVersion(d, i + 1);
  }
}

/**
 * Opens (or creates) the SQLite database at the given path.
 * Configures WAL mode, runs pending migrations.
 */
export function openDatabase(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  logger.info(`database opened at ${dbPath}`);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('database closed');
  }
}

function getDb(): DatabaseSync {
  if (!db) {
    throw new Error('Database not initialized. Call openDatabase() first.');
  }
  return db;
}

export function findSession(channelId: string, threadTs: string | null): SessionRow | undefined {
  const stmt = getDb().prepare(
    'SELECT * FROM sessions WHERE slack_channel_id = ? AND slack_thread_ts IS ?',
  );
  return stmt.get(channelId, threadTs) as unknown as SessionRow | undefined;
}

export function createSession(
  channelId: string,
  threadTs: string | null,
  agentId: string,
  providerSessionId: string,
): SessionRow {
  const stmt = getDb().prepare(
    `INSERT INTO sessions (slack_channel_id, slack_thread_ts, agent_id, provider_session_id)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(channelId, threadTs, agentId, providerSessionId) as unknown as SessionRow;
}

export function touchSession(id: number, messageCountDelta = 1): void {
  const stmt = getDb().prepare(
    `UPDATE sessions SET last_active = datetime('now'), message_count = message_count + ? WHERE id = ?`,
  );
  stmt.run(messageCountDelta, id);
}

export function listSessions(page = 1, perPage = DEFAULT_PER_PAGE): PaginatedResult<SessionRow> {
  return paginate<SessionRow>('sessions', page, perPage, '', [], 'last_active DESC');
}

export function getSession(id: number): SessionRow | undefined {
  return getDb()
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(id) as unknown as SessionRow | undefined;
}

export function getSessionMessages(
  channelId: string,
  threadTs: string | null,
  page = 1,
  perPage = DEFAULT_PER_PAGE,
): PaginatedResult<MessageRow> {
  const pp = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
  const p = Math.max(page, 1);
  const offset = (p - 1) * pp;

  const countRow = getDb()
    .prepare(
      'SELECT COUNT(*) as count FROM messages WHERE slack_channel_id = ? AND slack_thread_ts IS ?',
    )
    .get(channelId, threadTs) as unknown as { count: number };

  const totalItems = countRow.count;
  const totalPages = Math.max(Math.ceil(totalItems / pp), 1);

  const items = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE slack_channel_id = ? AND slack_thread_ts IS ?
       ORDER BY created_at ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(channelId, threadTs, pp, offset) as unknown as MessageRow[];

  return { items, page: p, perPage: pp, totalItems, totalPages };
}

export function getSessionTokenStats(
  channelId: string,
  threadTs: string | null,
): { totalTokensIn: number; totalTokensOut: number } {
  return getDb()
    .prepare(
      `SELECT COALESCE(SUM(tokens_in), 0) as totalTokensIn,
              COALESCE(SUM(tokens_out), 0) as totalTokensOut
       FROM messages
       WHERE slack_channel_id = ? AND slack_thread_ts IS ?`,
    )
    .get(channelId, threadTs) as unknown as { totalTokensIn: number; totalTokensOut: number };
}

export function deleteStaleSessions(ttlHours: number): number {
  const stmt = getDb().prepare(
    `DELETE FROM sessions WHERE last_active < datetime('now', ? || ' hours')`,
  );
  const result = stmt.run(`-${ttlHours}`);
  return Number(result.changes);
}

export function listCronJobs(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  includeSystem = false,
): PaginatedResult<CronJobRow> {
  const where = includeSystem ? '' : `name NOT LIKE '${SYSTEM_CRON_PREFIX}%'`;
  return paginate<CronJobRow>('cron_jobs', page, perPage, where, [], 'id ASC');
}

export function getEnabledCronJobs(): CronJobRow[] {
  return getDb()
    .prepare('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY id')
    .all() as unknown as CronJobRow[];
}

export function createCronJob(
  name: string,
  schedule: string,
  prompt: string,
  targetChannelId?: string,
  agentId?: string,
): CronJobRow {
  const stmt = getDb().prepare(
    `INSERT INTO cron_jobs (name, schedule, prompt, target_channel_id, agent_id)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    name,
    schedule,
    prompt,
    targetChannelId ?? null,
    agentId ?? 'default',
  ) as unknown as CronJobRow;
}

export function updateCronJobStatus(jobId: number, status: string, failureCount: number): void {
  const stmt = getDb().prepare(
    `UPDATE cron_jobs SET last_run = datetime('now'), last_status = ?, failure_count = ? WHERE id = ?`,
  );
  stmt.run(status, failureCount, jobId);
}

export function getCronJob(jobId: number): CronJobRow | undefined {
  return getDb().prepare('SELECT * FROM cron_jobs WHERE id = ?').get(jobId) as unknown as
    | CronJobRow
    | undefined;
}

export function setCronJobEnabled(jobId: number, enabled: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE cron_jobs SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, jobId);
  return Number(result.changes) > 0;
}

export interface UpdateCronJobFields {
  name?: string;
  schedule?: string;
  prompt?: string;
  targetChannelId?: string | null;
  agentId?: string;
}

export function updateCronJob(jobId: number, fields: UpdateCronJobFields): CronJobRow | undefined {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name);
  }
  if (fields.schedule !== undefined) {
    sets.push('schedule = ?');
    params.push(fields.schedule);
  }
  if (fields.prompt !== undefined) {
    sets.push('prompt = ?');
    params.push(fields.prompt);
  }
  if (fields.targetChannelId !== undefined) {
    sets.push('target_channel_id = ?');
    params.push(fields.targetChannelId);
  }
  if (fields.agentId !== undefined) {
    sets.push('agent_id = ?');
    params.push(fields.agentId);
  }

  if (sets.length === 0) return getCronJob(jobId);

  params.push(jobId);
  return getDb()
    .prepare(`UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
    .get(...params) as unknown as CronJobRow | undefined;
}

export function deleteCronJob(jobId: number): boolean {
  const result = getDb().prepare('DELETE FROM cron_jobs WHERE id = ?').run(jobId);
  return Number(result.changes) > 0;
}

export function createCronRun(jobId: number): CronRunRow {
  const stmt = getDb().prepare('INSERT INTO cron_runs (job_id) VALUES (?) RETURNING *');
  return stmt.get(jobId) as unknown as CronRunRow;
}

export function completeCronRun(
  runId: number,
  status: 'success' | 'error',
  result?: string,
  error?: string,
): void {
  const stmt = getDb().prepare(
    `UPDATE cron_runs SET finished_at = datetime('now'), status = ?, result = ?, error = ? WHERE id = ?`,
  );
  stmt.run(status, result ?? null, error ?? null, runId);
}

export function logMessage(
  channelId: string,
  threadTs: string | null,
  userId: string,
  direction: 'in' | 'out',
  content?: string,
  tokensIn?: number,
  tokensOut?: number,
): void {
  const stmt = getDb().prepare(
    `INSERT INTO messages (slack_channel_id, slack_thread_ts, slack_user_id, direction, content, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    channelId,
    threadTs ?? null,
    userId,
    direction,
    content ?? null,
    tokensIn ?? null,
    tokensOut ?? null,
  );
}

export function updateSessionProviderId(id: number, providerSessionId: string): void {
  getDb()
    .prepare('UPDATE sessions SET provider_session_id = ? WHERE id = ?')
    .run(providerSessionId, id);
}

export function countActiveSessions(ttlHours: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM sessions WHERE last_active >= datetime('now', ? || ' hours')`,
    )
    .get(`-${ttlHours}`) as unknown as { count: number };
  return row.count;
}

export function deleteOldMessages(retentionDays: number): number {
  const stmt = getDb().prepare(
    `DELETE FROM messages WHERE created_at < datetime('now', ? || ' days')`,
  );
  const result = stmt.run(`-${retentionDays}`);
  return Number(result.changes);
}

export function deleteOldCronRuns(retentionDays: number): number {
  const stmt = getDb().prepare(
    `DELETE FROM cron_runs WHERE started_at < datetime('now', ? || ' days')`,
  );
  const result = stmt.run(`-${retentionDays}`);
  return Number(result.changes);
}

/** Runs WAL checkpoint and query planner optimization. Safe to call periodically. */
export function optimizeDatabase(): void {
  const d = getDb();
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  d.exec('PRAGMA optimize');
}

/** Wraps a function in BEGIN/COMMIT with automatic ROLLBACK on error. */
export function transaction<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

export interface CreateJobOptions {
  name: string;
  payload?: unknown;
  priority?: JobPriority;
  maxAttempts?: number;
  timeout?: number;
  delaySeconds?: number;
  cronJobId?: number;
}

export function createJob(options: CreateJobOptions): JobRow {
  const payload = options.payload != null ? JSON.stringify(options.payload) : null;
  const priority = options.priority ?? 'normal';
  const maxAttempts = options.maxAttempts ?? 1;
  const timeout = options.timeout ?? 1800;
  const cronJobId = options.cronJobId ?? null;

  if (options.delaySeconds) {
    return getDb()
      .prepare(
        `INSERT INTO jobs (name, payload, priority, max_attempts, timeout, cron_job_id, run_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))
         RETURNING *`,
      )
      .get(
        options.name,
        payload,
        priority,
        maxAttempts,
        timeout,
        cronJobId,
        options.delaySeconds,
      ) as unknown as JobRow;
  }

  return getDb()
    .prepare(
      `INSERT INTO jobs (name, payload, priority, max_attempts, timeout, cron_job_id)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(options.name, payload, priority, maxAttempts, timeout, cronJobId) as unknown as JobRow;
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

/** Marks running jobs past their timeout as failed. */
export function failStaleJobs(): number {
  const stmt = getDb().prepare(
    `UPDATE jobs SET status = 'failed', error = 'timeout', completed_at = datetime('now')
     WHERE status = 'running'
       AND started_at < datetime('now', '-' || timeout || ' seconds')`,
  );
  return Number(stmt.run().changes);
}

export function deleteOldJobs(retentionDays: number): number {
  const stmt = getDb().prepare(
    `DELETE FROM jobs WHERE status IN ('completed', 'failed')
     AND completed_at < datetime('now', ? || ' days')`,
  );
  return Number(stmt.run(`-${retentionDays}`).changes);
}

export function countPendingJobs(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'`)
    .get() as unknown as { count: number };
  return row.count;
}

export interface ListJobsFilters {
  status?: string;
  cronJobId?: number;
  name?: string;
}

export function listJobs(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  filters: ListJobsFilters = {},
): PaginatedResult<JobRow> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.cronJobId != null) {
    conditions.push('cron_job_id = ?');
    params.push(filters.cronJobId);
  }
  if (filters.name) {
    conditions.push('name LIKE ?');
    params.push(`%${filters.name}%`);
  }

  const where = conditions.join(' AND ');
  return paginate<JobRow>('jobs', page, perPage, where, params, 'created_at DESC');
}

export interface JobStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
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

export function ensureSystemCronJob(name: string, schedule: string, prompt: string): void {
  const existing = getDb().prepare('SELECT id FROM cron_jobs WHERE name = ?').get(name) as
    | unknown
    | undefined;
  if (existing) return;
  getDb()
    .prepare(`INSERT INTO cron_jobs (name, schedule, prompt, agent_id) VALUES (?, ?, ?, 'system')`)
    .run(name, schedule, prompt);
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRow {
  id: number;
  level: LogLevel;
  source: string;
  message: string;
  channel_id: string | null;
  created_at: string;
}

export function insertLog(
  level: LogLevel,
  source: string,
  message: string,
  channelId?: string,
): void {
  getDb()
    .prepare(`INSERT INTO logs (level, source, message, channel_id) VALUES (?, ?, ?, ?)`)
    .run(level, source, message, channelId ?? null);
}

export function getRecentLogs(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  level?: string,
  source?: string,
): PaginatedResult<LogRow> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (level) {
    conditions.push('level = ?');
    params.push(level);
  }
  if (source) {
    conditions.push('source = ?');
    params.push(source);
  }
  const where = conditions.join(' AND ');
  return paginate<LogRow>('logs', page, perPage, where, params, 'created_at DESC');
}

export function deleteOldLogs(retentionDays: number): number {
  const stmt = getDb().prepare(`DELETE FROM logs WHERE created_at < datetime('now', ? || ' days')`);
  return Number(stmt.run(`-${retentionDays}`).changes);
}

export function getMessageStats(): {
  totalMessages: number;
  totalTokensIn: number;
  totalTokensOut: number;
} {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) as totalMessages,
         COALESCE(SUM(tokens_in), 0) as totalTokensIn,
         COALESCE(SUM(tokens_out), 0) as totalTokensOut
       FROM messages`,
    )
    .get() as unknown as { totalMessages: number; totalTokensIn: number; totalTokensOut: number };
  return row;
}

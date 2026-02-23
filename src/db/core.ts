/** @fileoverview SQLite database lifecycle, migrations, and query utilities. */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../core/logger.ts';

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 100;

export function paginate<T>(
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
          channel_id TEXT NOT NULL,
          thread_id TEXT,
          agent_id TEXT NOT NULL DEFAULT 'default',
          provider_session_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_active TEXT NOT NULL DEFAULT (datetime('now')),
          message_count INTEGER NOT NULL DEFAULT 0,
          UNIQUE(channel_id, thread_id)
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
          channel_id TEXT NOT NULL,
          thread_id TEXT,
          user_id TEXT NOT NULL,
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
          cron_job_id INTEGER REFERENCES cron_jobs(id),
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
          ON sessions(channel_id, thread_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_last_active
          ON sessions(last_active);
        CREATE INDEX IF NOT EXISTS idx_messages_channel_thread
          ON messages(channel_id, thread_id);
        CREATE INDEX IF NOT EXISTS idx_messages_created_at
          ON messages(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cron_runs_job_id
          ON cron_runs(job_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled
          ON cron_jobs(enabled);
        CREATE INDEX IF NOT EXISTS idx_jobs_poll
          ON jobs(status, priority, run_at, created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_cron_job_id
          ON jobs(cron_job_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_stale
          ON jobs(status, started_at);
        CREATE INDEX IF NOT EXISTS idx_logs_created_at
          ON logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_logs_level_source
          ON logs(level, source, created_at DESC);
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

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error('Database not initialized. Call openDatabase() first.');
  }
  return db;
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

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

export interface PaginateOptions {
  where?: string;
  params?: (string | number)[];
  defaultSort?: string;
  sort?: string;
  search?: string;
  allowedSortColumns?: ReadonlySet<string>;
  searchColumns?: readonly string[];
}

export const DEFAULT_PER_PAGE = 15;
export const MAX_PER_PAGE = 100;

/**
 * Parses a sort string into an SQL ORDER BY clause.
 * Each token is a column name optionally prefixed with `-` for DESC.
 * Only columns present in `allowedColumns` are included.
 */
export function parseSort(
  raw: string | undefined,
  allowedColumns: ReadonlySet<string>,
  fallback: string,
): string {
  if (!raw) return fallback;
  const parts: string[] = [];
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const desc = trimmed.startsWith('-');
    const col = desc ? trimmed.slice(1) : trimmed;
    if (allowedColumns.has(col)) {
      parts.push(`${col} ${desc ? 'DESC' : 'ASC'}`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : fallback;
}

/**
 * Builds a parenthesized OR clause for LIKE-based search across columns.
 * Returns empty sql/params when the search term is empty.
 */
export function buildSearchClause(
  term: string | undefined,
  columns: readonly string[],
): { sql: string; params: string[] } {
  if (!term || columns.length === 0) return { sql: '', params: [] };
  const like = `%${term}%`;
  const sql = `(${columns.map((c) => `${c} LIKE ?`).join(' OR ')})`;
  const params = columns.map(() => like);
  return { sql, params };
}

export function paginate<T>(
  table: string,
  page: number,
  perPage: number,
  whereOrOptions?: string | PaginateOptions,
  params?: (string | number)[],
  orderBy?: string,
): PaginatedResult<T> {
  let where: string;
  let allParams: (string | number)[];
  let resolvedOrderBy: string;

  if (typeof whereOrOptions === 'object' && whereOrOptions !== null) {
    const opts = whereOrOptions;
    const conditions: string[] = [];
    allParams = [...(opts.params ?? [])];

    if (opts.where) conditions.push(opts.where);

    if (opts.search && opts.searchColumns && opts.searchColumns.length > 0) {
      const sc = buildSearchClause(opts.search, opts.searchColumns);
      if (sc.sql) {
        conditions.push(sc.sql);
        allParams.push(...sc.params);
      }
    }

    where = conditions.join(' AND ');
    resolvedOrderBy = parseSort(
      opts.sort,
      opts.allowedSortColumns ?? new Set<string>(),
      opts.defaultSort ?? 'created_at DESC',
    );
  } else {
    where = whereOrOptions ?? '';
    allParams = params ?? [];
    resolvedOrderBy = orderBy ?? 'created_at DESC';
  }

  const pp = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
  const p = Math.max(page, 1);
  const offset = (p - 1) * pp;

  const countSql = `SELECT COUNT(*) as count FROM ${table}${where ? ` WHERE ${where}` : ''}`;
  const countRow = getDb()
    .prepare(countSql)
    .get(...allParams) as unknown as { count: number };
  const totalItems = countRow.count;
  const totalPages = Math.max(Math.ceil(totalItems / pp), 1);

  const dataSql = `SELECT * FROM ${table}${where ? ` WHERE ${where}` : ''} ORDER BY ${resolvedOrderBy} LIMIT ? OFFSET ?`;
  const items = getDb()
    .prepare(dataSql)
    .all(...allParams, pp, offset) as unknown as T[];

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
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          token_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          uid TEXT PRIMARY KEY,
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
          uid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          agent_id TEXT NOT NULL DEFAULT 'default',
          schedule TEXT NOT NULL,
          prompt TEXT NOT NULL,
          target_channel_id TEXT,
          active_hours_start TEXT,
          active_hours_end TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_run TEXT,
          last_status TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cron_runs (
          uid TEXT PRIMARY KEY,
          job_uid TEXT NOT NULL REFERENCES cron_jobs(uid),
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
          cron_job_uid TEXT REFERENCES cron_jobs(uid),
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
        CREATE INDEX IF NOT EXISTS idx_cron_runs_job_uid
          ON cron_runs(job_uid, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled
          ON cron_jobs(enabled);
        CREATE INDEX IF NOT EXISTS idx_jobs_poll
          ON jobs(status, priority, run_at, created_at);
        CREATE INDEX IF NOT EXISTS idx_jobs_cron_job_uid
          ON jobs(cron_job_uid);
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
    name: 'browser lock',
    up(d) {
      d.exec(`
        CREATE TABLE IF NOT EXISTS browser_lock (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          holder TEXT NOT NULL,
          acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    name: 'feedback',
    up(d) {
      d.exec(`
        CREATE TABLE IF NOT EXISTS feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          channel_id TEXT NOT NULL,
          thread_id TEXT,
          message_ts TEXT,
          user_id TEXT NOT NULL,
          value TEXT NOT NULL CHECK(value IN ('good', 'bad')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(channel_id, message_ts, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_feedback_channel_thread
          ON feedback(channel_id, thread_id);
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
 * Safe to call on every startup; already-applied migrations are skipped.
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
      setSchemaVersion(d, i + 1);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw new Error(
        `migration "${migration.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
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
  logger.debug(`database opened at ${dbPath}`);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.debug('database closed');
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

/**
 * Resolves a row by UID or UID prefix, like git's short SHA resolution.
 * Exact match first (fast path), then prefix scan via LIKE.
 */
export function resolveByUid<T>(
  table: string,
  uidPrefix: string,
): { row: T } | { ambiguous: true; count: number } | undefined {
  const input = uidPrefix.toLowerCase();
  const d = getDb();

  const exact = d.prepare(`SELECT * FROM ${table} WHERE uid = ?`).get(input) as unknown as
    | T
    | undefined;
  if (exact) return { row: exact };

  const rows = d
    .prepare(`SELECT * FROM ${table} WHERE uid LIKE ? LIMIT 2`)
    .all(`${input}%`) as unknown as T[];
  if (rows.length === 0) return undefined;
  if (rows.length > 1) {
    const countRow = d
      .prepare(`SELECT COUNT(*) as count FROM ${table} WHERE uid LIKE ?`)
      .get(`${input}%`) as unknown as { count: number };
    return { ambiguous: true, count: countRow.count };
  }
  return { row: rows[0]! };
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

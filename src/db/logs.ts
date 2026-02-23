/** @fileoverview Structured log persistence — queryable via web UI. */

import type { PaginatedResult } from './core.ts';
import { getDb, paginate, DEFAULT_PER_PAGE } from './core.ts';

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

const LOG_SORT_COLUMNS = new Set(['id', 'level', 'source', 'created_at']);
const LOG_SEARCH_COLUMNS = ['message', 'source'] as const;

export function getRecentLogs(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  level?: string,
  source?: string,
  sort?: string,
  search?: string,
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
  return paginate<LogRow>('logs', page, perPage, {
    where,
    params,
    defaultSort: 'created_at DESC',
    sort,
    search,
    allowedSortColumns: LOG_SORT_COLUMNS,
    searchColumns: LOG_SEARCH_COLUMNS,
  });
}

export function deleteOldLogs(retentionDays: number): number {
  const stmt = getDb().prepare(`DELETE FROM logs WHERE created_at < datetime('now', ? || ' days')`);
  return Number(stmt.run(`-${retentionDays}`).changes);
}

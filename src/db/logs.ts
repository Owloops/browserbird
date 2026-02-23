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

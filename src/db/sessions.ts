/** @fileoverview Session persistence — channel-to-agent session mapping. */

import type { PaginatedResult } from './core.ts';
import type { MessageRow } from './messages.ts';
import {
  getDb,
  paginate,
  parseSort,
  buildSearchClause,
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
} from './core.ts';

export interface SessionRow {
  id: number;
  channel_id: string;
  thread_id: string | null;
  agent_id: string;
  provider_session_id: string;
  created_at: string;
  last_active: string;
  message_count: number;
}

export function findSession(channelId: string, threadId: string | null): SessionRow | undefined {
  const stmt = getDb().prepare('SELECT * FROM sessions WHERE channel_id = ? AND thread_id IS ?');
  return stmt.get(channelId, threadId) as unknown as SessionRow | undefined;
}

export function createSession(
  channelId: string,
  threadId: string | null,
  agentId: string,
  providerSessionId: string,
): SessionRow {
  const stmt = getDb().prepare(
    `INSERT INTO sessions (channel_id, thread_id, agent_id, provider_session_id)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(channelId, threadId, agentId, providerSessionId) as unknown as SessionRow;
}

export function touchSession(id: number, messageCountDelta = 1): void {
  const stmt = getDb().prepare(
    `UPDATE sessions SET last_active = datetime('now'), message_count = message_count + ? WHERE id = ?`,
  );
  stmt.run(messageCountDelta, id);
}

const SESSION_SORT_COLUMNS = new Set([
  'id',
  'channel_id',
  'agent_id',
  'message_count',
  'last_active',
  'created_at',
]);
const SESSION_SEARCH_COLUMNS = ['channel_id', 'thread_id', 'agent_id'] as const;

export function listSessions(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  sort?: string,
  search?: string,
): PaginatedResult<SessionRow> {
  return paginate<SessionRow>('sessions', page, perPage, {
    defaultSort: 'last_active DESC',
    sort,
    search,
    allowedSortColumns: SESSION_SORT_COLUMNS,
    searchColumns: SESSION_SEARCH_COLUMNS,
  });
}

export function getSession(id: number): SessionRow | undefined {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as
    | SessionRow
    | undefined;
}

const MESSAGE_SORT_COLUMNS = new Set(['id', 'created_at', 'direction', 'user_id']);
const MESSAGE_SEARCH_COLUMNS = ['content', 'user_id'] as const;

export function getSessionMessages(
  channelId: string,
  threadId: string | null,
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  sort?: string,
  search?: string,
): PaginatedResult<MessageRow> {
  const pp = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
  const p = Math.max(page, 1);
  const offset = (p - 1) * pp;

  const conditions = ['channel_id = ? AND thread_id IS ?'];
  const allParams: (string | number)[] = [channelId, threadId as string];

  if (search) {
    const sc = buildSearchClause(search, MESSAGE_SEARCH_COLUMNS);
    if (sc.sql) {
      conditions.push(sc.sql);
      allParams.push(...sc.params);
    }
  }

  const where = conditions.join(' AND ');
  const orderBy = parseSort(sort, MESSAGE_SORT_COLUMNS, 'created_at ASC, id ASC');

  const countRow = getDb()
    .prepare(`SELECT COUNT(*) as count FROM messages WHERE ${where}`)
    .get(...allParams) as unknown as { count: number };

  const totalItems = countRow.count;
  const totalPages = Math.max(Math.ceil(totalItems / pp), 1);

  const items = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...allParams, pp, offset) as unknown as MessageRow[];

  return { items, page: p, perPage: pp, totalItems, totalPages };
}

export function getSessionTokenStats(
  channelId: string,
  threadId: string | null,
): { totalTokensIn: number; totalTokensOut: number } {
  return getDb()
    .prepare(
      `SELECT COALESCE(SUM(tokens_in), 0) as totalTokensIn,
              COALESCE(SUM(tokens_out), 0) as totalTokensOut
       FROM messages
       WHERE channel_id = ? AND thread_id IS ?`,
    )
    .get(channelId, threadId) as unknown as { totalTokensIn: number; totalTokensOut: number };
}

export function deleteStaleSessions(ttlHours: number): number {
  const stmt = getDb().prepare(
    `DELETE FROM sessions WHERE last_active < datetime('now', ? || ' hours')`,
  );
  const result = stmt.run(`-${ttlHours}`);
  return Number(result.changes);
}

export function countActiveSessions(ttlHours: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM sessions WHERE last_active >= datetime('now', ? || ' hours')`,
    )
    .get(`-${ttlHours}`) as unknown as { count: number };
  return row.count;
}

export function updateSessionProviderId(id: number, providerSessionId: string): void {
  getDb()
    .prepare('UPDATE sessions SET provider_session_id = ? WHERE id = ?')
    .run(providerSessionId, id);
}

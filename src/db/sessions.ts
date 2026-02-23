/** @fileoverview Session persistence — channel-to-agent session mapping. */

import type { PaginatedResult } from './core.ts';
import type { MessageRow } from './messages.ts';
import { getDb, paginate, DEFAULT_PER_PAGE, MAX_PER_PAGE } from './core.ts';

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

export function listSessions(page = 1, perPage = DEFAULT_PER_PAGE): PaginatedResult<SessionRow> {
  return paginate<SessionRow>('sessions', page, perPage, '', [], 'last_active DESC');
}

export function getSession(id: number): SessionRow | undefined {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as
    | SessionRow
    | undefined;
}

export function getSessionMessages(
  channelId: string,
  threadId: string | null,
  page = 1,
  perPage = DEFAULT_PER_PAGE,
): PaginatedResult<MessageRow> {
  const pp = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
  const p = Math.max(page, 1);
  const offset = (p - 1) * pp;

  const countRow = getDb()
    .prepare('SELECT COUNT(*) as count FROM messages WHERE channel_id = ? AND thread_id IS ?')
    .get(channelId, threadId) as unknown as { count: number };

  const totalItems = countRow.count;
  const totalPages = Math.max(Math.ceil(totalItems / pp), 1);

  const items = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE channel_id = ? AND thread_id IS ?
       ORDER BY created_at ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(channelId, threadId, pp, offset) as unknown as MessageRow[];

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

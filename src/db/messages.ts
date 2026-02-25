/** @fileoverview Message logging — message audit trail and token tracking. */

import { getDb } from './core.ts';

export interface MessageRow {
  id: number;
  channel_id: string;
  thread_id: string | null;
  user_id: string;
  direction: 'in' | 'out';
  content: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export function logMessage(
  channelId: string,
  threadId: string | null,
  userId: string,
  direction: 'in' | 'out',
  content?: string,
  tokensIn?: number,
  tokensOut?: number,
): void {
  const stmt = getDb().prepare(
    `INSERT INTO messages (channel_id, thread_id, user_id, direction, content, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    channelId,
    threadId ?? null,
    userId,
    direction,
    content ?? null,
    tokensIn ?? null,
    tokensOut ?? null,
  );
}

export function getLastInboundMessage(
  channelId: string,
  threadId: string | null,
): { content: string; timestamp: string } | undefined {
  const row = getDb()
    .prepare(
      `SELECT content, created_at FROM messages
       WHERE channel_id = ? AND thread_id IS ? AND direction = 'in' AND content IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(channelId, threadId) as unknown as { content: string; created_at: string } | undefined;
  if (!row) return undefined;
  return { content: row.content, timestamp: row.created_at };
}

export function deleteOldMessages(retentionDays: number): number {
  const stmt = getDb().prepare(
    `DELETE FROM messages WHERE created_at < datetime('now', ? || ' days')`,
  );
  const result = stmt.run(`-${retentionDays}`);
  return Number(result.changes);
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

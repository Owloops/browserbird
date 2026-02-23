/** @fileoverview Message logging — Slack message audit trail and token tracking. */

import { getDb } from './core.ts';

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

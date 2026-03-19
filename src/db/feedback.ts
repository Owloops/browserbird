/** @fileoverview Response feedback persistence (thumbs up/down). */

import { getDb } from './core.ts';

export type FeedbackValue = 'good' | 'bad';

export function insertFeedback(
  channelId: string,
  threadId: string | undefined,
  messageTs: string | undefined,
  userId: string,
  value: FeedbackValue,
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO feedback (channel_id, thread_id, message_ts, user_id, value)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(channelId, threadId ?? null, messageTs ?? null, userId, value);
}

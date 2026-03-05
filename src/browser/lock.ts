/** @fileoverview SQLite-based browser lock for persistent browser mode. */

import { getDb } from '../db/core.ts';

/**
 * Attempts to acquire the browser lock for a given holder.
 * Uses a single conditional UPSERT: inserts if absent, overwrites if stale.
 * Returns false when an active (non-stale) lock is held by someone else.
 */
export function acquireBrowserLock(holder: string, timeoutMs: number): boolean {
  const timeoutSeconds = Math.ceil(timeoutMs / 1000);
  const result = getDb()
    .prepare(
      `INSERT INTO browser_lock (id, holder, acquired_at)
       VALUES (1, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         holder = excluded.holder,
         acquired_at = excluded.acquired_at
       WHERE acquired_at <= datetime('now', '-' || ? || ' seconds')`,
    )
    .run(holder, timeoutSeconds);
  return Number(result.changes) > 0;
}

/** Releases the browser lock only if the caller is the current holder. */
export function releaseBrowserLock(holder: string): void {
  getDb().prepare('DELETE FROM browser_lock WHERE id = 1 AND holder = ?').run(holder);
}

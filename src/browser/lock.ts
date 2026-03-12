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

/** Refreshes the lock timestamp to prevent staleness during long operations. */
export function refreshBrowserLock(holder: string): void {
  getDb()
    .prepare(`UPDATE browser_lock SET acquired_at = datetime('now') WHERE id = 1 AND holder = ?`)
    .run(holder);
}

/** Releases the browser lock only if the caller is the current holder. */
export function releaseBrowserLock(holder: string): void {
  getDb().prepare('DELETE FROM browser_lock WHERE id = 1 AND holder = ?').run(holder);
}

export const LOCK_HEARTBEAT_MS = 30_000;

export interface BrowserLockHandle {
  release(): void;
}

/**
 * Acquires the browser lock and starts a heartbeat interval.
 * Returns a handle with a `release()` method, or null if the lock is unavailable.
 */
export function acquireBrowserLockWithHeartbeat(
  holder: string,
  timeoutMs: number,
): BrowserLockHandle | null {
  if (!acquireBrowserLock(holder, timeoutMs)) return null;
  const timer = setInterval(() => refreshBrowserLock(holder), LOCK_HEARTBEAT_MS);
  return {
    release() {
      clearInterval(timer);
      releaseBrowserLock(holder);
    },
  };
}

/** Clears any browser lock unconditionally. Called on startup before any sessions exist. */
export function clearBrowserLock(): void {
  getDb().prepare('DELETE FROM browser_lock WHERE id = 1').run();
}

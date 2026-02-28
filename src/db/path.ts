/** @fileoverview Database path resolution: CLI flag, env var, or default. */

import { resolve } from 'node:path';

const DEFAULT_DB_PATH = resolve('.browserbird', 'browserbird.db');

/**
 * Resolves the database file path.
 * Priority: explicit value > BROWSERBIRD_DB env var > default.
 */
export function resolveDbPath(explicit?: string): string {
  if (explicit) return resolve(explicit);

  const envValue = process.env['BROWSERBIRD_DB'];
  if (envValue) return resolve(envValue);

  return DEFAULT_DB_PATH;
}

/**
 * Extracts --db value from a raw argv array, then resolves.
 * Used by CLI command handlers that receive argv directly.
 */
export function resolveDbPathFromArgv(argv: string[]): string {
  const idx = argv.indexOf('--db');
  if (idx !== -1 && idx + 1 < argv.length) {
    return resolveDbPath(argv[idx + 1]);
  }
  return resolveDbPath();
}

/** @fileoverview Logs command: show recent log entries from the database. */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { logger } from '../core/logger.ts';
import { printTable } from '../core/utils.ts';
import { c } from './style.ts';
import { openDatabase, closeDatabase, getRecentLogs } from '../db/index.ts';

export const LOGS_HELP = `
${c('cyan', 'usage:')} browserbird logs [options]

show recent log entries (default: error level).

${c('dim', 'options:')}

  ${c('yellow', '--level')} <lvl>    filter by level: error, warn, info (default: error)
  ${c('yellow', '--limit')} <n>      number of entries to show (default: 20)
  ${c('yellow', '--json')}           output as JSON
  ${c('yellow', '--config')} <path>  config file path
  ${c('yellow', '-h, --help')}       show this help
`.trim();

export function handleLogs(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      level: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const level = values.level as string | undefined;
  const perPage = values.limit != null ? Number(values.limit) : 20;
  if (!Number.isFinite(perPage) || perPage < 1) {
    logger.error('--limit must be a positive number');
    process.exitCode = 1;
    return;
  }

  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);
  try {
    const result = getRecentLogs(1, perPage, level ?? 'error');
    if (values.json) {
      console.log(JSON.stringify(result.items, null, 2));
      return;
    }
    console.log(`logs (${result.totalItems} total, showing ${result.items.length}):`);
    if (result.items.length === 0) {
      console.log('\n  no logs recorded');
      return;
    }
    console.log('');
    const rows = result.items.map((entry) => [
      entry.created_at.slice(11, 19),
      entry.level,
      entry.source,
      entry.message,
    ]);
    printTable(['time', 'level', 'source', 'message'], rows, [undefined, undefined, undefined, 80]);
  } finally {
    closeDatabase();
  }
}

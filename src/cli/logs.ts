/** @fileoverview Logs command: show recent log entries via the daemon API. */

import { parseArgs } from 'node:util';
import { logger } from '../core/logger.ts';
import { printTable } from '../core/utils.ts';
import { c } from './style.ts';
import type { LogRow, PaginatedResult } from '../db/index.ts';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

export const LOGS_HELP = `
${c('cyan', 'usage:')} browserbird logs [options]

show recent log entries (default: error level).

${c('dim', 'options:')}

  ${c('yellow', '--level')} <lvl>    filter by level: error, warn, info (default: error)
  ${c('yellow', '--limit')} <n>      number of entries to show (default: 20)
  ${c('yellow', '--json')}           output as JSON
  ${c('yellow', '-h, --help')}       show this help
`.trim();

async function runDaemonCall<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (
      err instanceof DaemonAuthError ||
      err instanceof DaemonUnreachableError ||
      err instanceof DaemonError
    ) {
      logger.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    throw err;
  }
}

export async function handleLogs(argv: string[]): Promise<void> {
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

  const level = (values.level as string | undefined) ?? 'error';
  const perPage = values.limit != null ? Number(values.limit) : 20;
  if (!Number.isFinite(perPage) || perPage < 1) {
    logger.error('--limit must be a positive number');
    process.exitCode = 1;
    return;
  }

  const params = new URLSearchParams({ perPage: String(perPage), level });
  const result = await runDaemonCall<PaginatedResult<LogRow>>(() =>
    daemonRequest<PaginatedResult<LogRow>>({
      method: 'GET',
      path: `/api/logs?${params.toString()}`,
    }),
  );
  if (!result) return;
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
}

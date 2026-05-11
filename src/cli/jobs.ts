/** @fileoverview Jobs command: inspect and manage the job queue. */

import { parseArgs } from 'node:util';
import { logger } from '../core/logger.ts';
import { printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import {
  openDatabase,
  closeDatabase,
  listJobs,
  getJobStats,
  resolveDbPathFromArgv,
} from '../db/index.ts';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

export const JOBS_HELP = `
${c('cyan', 'usage:')} browserbird jobs [subcommand] [options]

inspect and manage the job queue.

${c('dim', 'subcommands:')}

  ${c('cyan', 'list')}             list job queue entries (default)
  ${c('cyan', 'stats')}            show job queue statistics
  ${c('cyan', 'retry')} <id>       retry a failed job (or --all-failed)
  ${c('cyan', 'delete')} <id>      delete a job
  ${c('cyan', 'clear')}            clear completed or failed jobs

${c('dim', 'options:')}

  ${c('yellow', '--status')} <s>     filter by status: pending, running, completed, failed (with list)
  ${c('yellow', '--name')} <s>       filter by job name (with list)
  ${c('yellow', '--all-failed')}     retry all failed jobs (with retry)
  ${c('yellow', '--completed')}      clear completed jobs (with clear)
  ${c('yellow', '--failed')}         clear failed jobs (with clear)
  ${c('yellow', '--json')}           output as JSON (with list, stats)
  ${c('yellow', '--db')} <path>      database file path (env: BROWSERBIRD_DB)
  ${c('yellow', '--config')} <path>  config file path
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

export async function handleJobs(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      status: { type: 'string' },
      name: { type: 'string' },
      'all-failed': { type: 'boolean', default: false },
      completed: { type: 'boolean', default: false },
      failed: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const subcommand = positionals[0] ?? 'list';
  openDatabase(resolveDbPathFromArgv(argv));
  try {
    switch (subcommand) {
      case 'list': {
        const result = listJobs(1, 100, {
          status: values.status as string | undefined,
          name: values.name as string | undefined,
        });
        if (values.json) {
          console.log(JSON.stringify(result.items, null, 2));
          break;
        }
        console.log(`jobs (${result.totalItems} total):`);
        if (result.items.length === 0) {
          console.log('\n  no jobs found');
          return;
        }
        console.log('');
        const rows = result.items.map((job) => [
          String(job.id),
          job.status,
          job.name,
          `${job.attempts}/${job.max_attempts}`,
          job.created_at.slice(0, 19),
          job.error ?? '',
        ]);
        printTable(['id', 'status', 'name', 'attempts', 'created', 'error'], rows, [
          undefined,
          undefined,
          30,
          undefined,
          undefined,
          40,
        ]);
        break;
      }
      case 'stats': {
        const stats = getJobStats();
        if (values.json) {
          console.log(JSON.stringify(stats, null, 2));
          break;
        }
        console.log('job queue statistics');
        console.log('');
        console.log(`  pending:    ${stats.pending}`);
        console.log(`  running:    ${stats.running}`);
        console.log(`  completed:  ${stats.completed}`);
        console.log(`  failed:     ${stats.failed}`);
        console.log('              --');
        console.log(`  total:      ${stats.total}`);
        break;
      }
      case 'retry': {
        if (values['all-failed']) {
          const result = await runDaemonCall<{ count: number }>(() =>
            daemonRequest({ method: 'POST', path: '/api/jobs/retry-failed' }),
          );
          if (!result) return;
          logger.success(`reset ${result.count} failed job(s) to pending`);
          return;
        }
        const id = Number(positionals[1]);
        if (!Number.isFinite(id)) {
          logger.error('usage: browserbird jobs retry <id> | --all-failed');
          process.exitCode = 1;
          return;
        }
        const retried = await runDaemonCall(() =>
          daemonRequest<{ success?: boolean }>({
            method: 'POST',
            path: `/api/jobs/${id}/retry`,
          }),
        );
        if (retried === undefined) break;
        logger.success(`job #${id} reset to pending`);
        break;
      }
      case 'delete': {
        const id = Number(positionals[1]);
        if (!Number.isFinite(id)) {
          logger.error('usage: browserbird jobs delete <id>');
          process.exitCode = 1;
          return;
        }
        const deleted = await runDaemonCall(() =>
          daemonRequest<{ success?: boolean }>({
            method: 'DELETE',
            path: `/api/jobs/${id}`,
          }),
        );
        if (deleted === undefined) break;
        logger.success(`job #${id} deleted`);
        break;
      }
      case 'clear': {
        if (!values.completed && !values.failed) {
          logger.error('usage: browserbird jobs clear --completed | --failed');
          process.exitCode = 1;
          return;
        }
        const statuses: string[] = [];
        if (values.completed) statuses.push('completed');
        if (values.failed) statuses.push('failed');
        const result = await runDaemonCall<{ count: number }>(() =>
          daemonRequest({ method: 'POST', path: '/api/jobs/clear', body: { statuses } }),
        );
        if (!result) break;
        logger.success(`cleared ${result.count} job(s)`);
        break;
      }
      default:
        unknownSubcommand(subcommand, 'jobs', ['stats', 'retry', 'delete', 'clear']);
    }
  } finally {
    closeDatabase();
  }
}

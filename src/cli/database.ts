/** @fileoverview Database command — maintenance, logs, and job queue inspection. */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { logger } from '../core/logger.ts';
import { printTable, unknownSubcommand } from '../core/table.ts';
import {
  openDatabase,
  closeDatabase,
  listJobs,
  getJobStats,
  retryJob,
  retryAllFailedJobs,
  deleteJob,
  clearJobs,
  getRecentLogs,
} from '../db/index.ts';

export const DATABASE_HELP = `
usage: browserbird database <subcommand> [options]

database maintenance and inspection.

subcommands:

  logs             show recent log entries (default: error level)
  jobs             list raw job queue entries
  jobs stats       show job queue statistics
  jobs retry <id>  retry a failed job (or --all-failed)
  jobs delete <id> delete a job
  jobs clear       clear completed or failed jobs

options:

  --level <lvl>    filter by level: error, warn, info (with logs, default: error)
  --limit <n>      number of entries to show (with logs, default: 20)
  --status <s>     filter by status: pending, running, completed, failed (with jobs)
  --name <s>       filter by job name (with jobs)
  --all-failed     retry all failed jobs (with jobs retry)
  --completed      clear completed jobs (with jobs clear)
  --failed         clear failed jobs (with jobs clear)
  --config <path>  config file path
  -h, --help       show this help
`.trim();

export function handleDatabase(argv: string[]): void {
  const subcommand = argv[0];

  if (!subcommand) {
    console.log(DATABASE_HELP);
    return;
  }

  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      level: { type: 'string' },
      limit: { type: 'string' },
      status: { type: 'string' },
      name: { type: 'string' },
      'all-failed': { type: 'boolean', default: false },
      completed: { type: 'boolean', default: false },
      failed: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  switch (subcommand) {
    case 'logs': {
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
        printTable(['time', 'level', 'source', 'message'], rows, [
          undefined,
          undefined,
          undefined,
          80,
        ]);
      } finally {
        closeDatabase();
      }
      break;
    }

    case 'jobs': {
      const jobSubcommand = positionals[1] ?? 'list';
      const dbPath = resolve('.browserbird', 'browserbird.db');
      openDatabase(dbPath);
      try {
        switch (jobSubcommand) {
          case 'list': {
            const result = listJobs(1, 100, {
              status: values.status as string | undefined,
              name: values.name as string | undefined,
            });
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
              const count = retryAllFailedJobs();
              logger.success(`reset ${count} failed job(s) to pending`);
              return;
            }
            const id = Number(positionals[2]);
            if (!Number.isFinite(id)) {
              logger.error('usage: browserbird database jobs retry <id> | --all-failed');
              process.exitCode = 1;
              return;
            }
            if (retryJob(id)) {
              logger.success(`job #${id} reset to pending`);
            } else {
              logger.error(`job #${id} not found or not in failed state`);
              process.exitCode = 1;
            }
            break;
          }
          case 'delete': {
            const id = Number(positionals[2]);
            if (!Number.isFinite(id)) {
              logger.error('usage: browserbird database jobs delete <id>');
              process.exitCode = 1;
              return;
            }
            if (deleteJob(id)) {
              logger.success(`job #${id} deleted`);
            } else {
              logger.error(`job #${id} not found`);
              process.exitCode = 1;
            }
            break;
          }
          case 'clear': {
            if (!values.completed && !values.failed) {
              logger.error('usage: browserbird db jobs clear --completed | --failed');
              process.exitCode = 1;
              return;
            }
            let total = 0;
            if (values.completed) total += clearJobs('completed');
            if (values.failed) total += clearJobs('failed');
            logger.success(`cleared ${total} job(s)`);
            break;
          }
          default:
            unknownSubcommand(jobSubcommand, 'database jobs');
        }
      } finally {
        closeDatabase();
      }
      break;
    }

    default:
      unknownSubcommand(subcommand, 'database');
  }
}

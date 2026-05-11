/** @fileoverview Backups command: create, list, delete, and restore backups. */

import { parseArgs } from 'node:util';
import { dirname } from 'node:path';
import { logger } from '../core/logger.ts';
import { unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import { openDatabase, closeDatabase, resolveDbPathFromArgv } from '../db/index.ts';
import { listBackups } from '../core/backup.ts';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

export const BACKUPS_HELP = `
${c('cyan', 'usage:')} browserbird backups <subcommand> [options]

manage database backups.

${c('dim', 'subcommands:')}

  ${c('cyan', 'list')}              list available backups
  ${c('cyan', 'create')}            create a new backup
  ${c('cyan', 'delete')} <name>     delete a backup
  ${c('cyan', 'restore')} <name>    restore from a backup

${c('dim', 'options:')}

  ${c('yellow', '--name')} <name>     custom backup filename (with create)
  ${c('yellow', '--json')}            output as JSON (with list)
  ${c('yellow', '--db')} <path>       database file path (env: BROWSERBIRD_DB)
  ${c('yellow', '-h, --help')}        show this help
`.trim();

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

export async function handleBackups(argv: string[]): Promise<void> {
  const subcommand = argv[0] ?? 'list';
  const rest = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const dbPath = resolveDbPathFromArgv(argv);
  const dataDir = dirname(dbPath);

  openDatabase(dbPath);

  try {
    switch (subcommand) {
      case 'list': {
        const backups = listBackups(dataDir);
        if (values.json) {
          console.log(JSON.stringify(backups, null, 2));
          break;
        }
        console.log(`backups (${backups.length} total):`);
        if (backups.length === 0) {
          console.log('\n  no backups found');
          return;
        }
        console.log('');
        for (const b of backups) {
          const date = new Date(b.created).toLocaleString();
          console.log(`  ${c('cyan', b.name)}  ${formatSize(b.size)}  ${c('dim', date)}`);
        }
        break;
      }

      case 'create': {
        const customName = values.name as string | undefined;
        const info = await runDaemonCall<{ name: string; size: number; created: string }>(() =>
          daemonRequest({
            method: 'POST',
            path: '/api/backups',
            body: customName ? { name: customName } : {},
          }),
        );
        if (!info) break;
        logger.success(`backup created: ${info.name} (${formatSize(info.size)})`);
        break;
      }

      case 'delete': {
        const name = positionals[0];
        if (!name) {
          logger.error('usage: browserbird backups delete <name>');
          process.exitCode = 1;
          return;
        }
        const deleted = await runDaemonCall(() =>
          daemonRequest<{ success?: boolean }>({
            method: 'DELETE',
            path: `/api/backups/${encodeURIComponent(name)}`,
          }),
        );
        if (deleted === undefined) break;
        logger.success(`backup ${name} deleted`);
        break;
      }

      case 'restore': {
        const name = positionals[0];
        if (!name) {
          logger.error('usage: browserbird backups restore <name>');
          process.exitCode = 1;
          return;
        }
        const restored = await runDaemonCall(() =>
          daemonRequest<{ success?: boolean }>({
            method: 'POST',
            path: `/api/backups/${encodeURIComponent(name)}/restore`,
          }),
        );
        if (restored === undefined) break;
        logger.success(`restore initiated from ${name}`);
        process.stderr.write(
          c('dim', '  the daemon will restart to apply the restored data') + '\n',
        );
        break;
      }

      default:
        unknownSubcommand(subcommand, 'backups', ['list', 'create', 'delete', 'restore']);
    }
  } finally {
    closeDatabase();
  }
}

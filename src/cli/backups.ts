/** @fileoverview Backups command: create, list, delete, and restore backups. */

import { parseArgs } from 'node:util';
import { dirname } from 'node:path';
import { logger } from '../core/logger.ts';
import { unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import { openDatabase, closeDatabase, resolveDbPathFromArgv } from '../db/index.ts';
import { loadConfig, DEFAULT_CONFIG_PATH } from '../config.ts';
import { resolve } from 'node:path';
import {
  createBackup,
  listBackups,
  deleteBackup,
  restoreBackup,
  enforceRetention,
} from '../core/backup.ts';

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

export function handleBackups(argv: string[]): void {
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
        const info = createBackup(dataDir, customName);
        const configPath = process.env['BROWSERBIRD_CONFIG']
          ? resolve(process.env['BROWSERBIRD_CONFIG'])
          : DEFAULT_CONFIG_PATH;
        const maxCount = loadConfig(configPath).database.backups?.maxCount ?? 10;
        enforceRetention(dataDir, maxCount);
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
        try {
          deleteBackup(dataDir, name);
          logger.success(`backup ${name} deleted`);
        } catch (err) {
          logger.error((err as Error).message);
          process.exitCode = 1;
        }
        break;
      }

      case 'restore': {
        const name = positionals[0];
        if (!name) {
          logger.error('usage: browserbird backups restore <name>');
          process.exitCode = 1;
          return;
        }
        try {
          closeDatabase();
          restoreBackup(dataDir, name);
          logger.success(`restored from ${name}`);
          process.stderr.write(c('dim', '  restart the daemon to use the restored data') + '\n');
        } catch (err) {
          logger.error((err as Error).message);
          process.exitCode = 1;
        }
        break;
      }

      default:
        unknownSubcommand(subcommand, 'backups', ['list', 'create', 'delete', 'restore']);
    }
  } finally {
    closeDatabase();
  }
}

/** @fileoverview CLI entry point: argument parsing and command routing. */

import { parseArgs } from 'node:util';
import type { Command } from '../core/types.ts';
import { COMMANDS } from '../core/types.ts';
import { logger } from '../core/logger.ts';
import { unknownSubcommand } from '../core/utils.ts';
import { startDaemon } from '../daemon.ts';
import { BANNER, VERSION } from './banner.ts';
import { c } from './style.ts';
import { handleSessions } from './sessions.ts';
import { SESSIONS_HELP } from './sessions.ts';
import { handleBirds } from './birds.ts';
import { BIRDS_HELP } from './birds.ts';
import { handleDocs } from './docs.ts';
import { DOCS_HELP } from './docs.ts';
import { handleKeys } from './keys.ts';
import { KEYS_HELP } from './keys.ts';
import { handleLogs } from './logs.ts';
import { LOGS_HELP } from './logs.ts';
import { handleJobs } from './jobs.ts';
import { JOBS_HELP } from './jobs.ts';
import { handleConfig } from './config.ts';
import { CONFIG_HELP } from './config.ts';
import { handleBackups } from './backups.ts';
import { BACKUPS_HELP } from './backups.ts';
import { handleDoctor } from './doctor.ts';
import { DOCTOR_HELP } from './doctor.ts';

const MAIN_HELP =
  BANNER +
  `
${c('cyan', 'usage:')} browserbird [command] [options]

${c('dim', 'commands:')}

  ${c('cyan', 'sessions')}    manage sessions and chat
  ${c('cyan', 'birds')}       manage scheduled birds
  ${c('cyan', 'docs')}        manage system prompt documents
  ${c('cyan', 'keys')}        manage vault keys
  ${c('cyan', 'config')}      view configuration
  ${c('cyan', 'logs')}        show recent log entries
  ${c('cyan', 'jobs')}        inspect and manage the job queue
  ${c('cyan', 'backups')}     manage database backups
  ${c('cyan', 'doctor')}      check system dependencies

${c('dim', 'options:')}

  ${c('yellow', '-h, --help')}     show this help
  ${c('yellow', '-v, --version')}  show version
  ${c('yellow', '--verbose')}      enable debug logging
  ${c('yellow', '--config')}       config file path (env: BROWSERBIRD_CONFIG)
  ${c('yellow', '--db')}           database file path (env: BROWSERBIRD_DB)

run 'browserbird <command> --help' for command-specific options.`.trimEnd();

const COMMAND_HELP: Record<string, string> = {
  sessions: SESSIONS_HELP,
  birds: BIRDS_HELP,
  docs: DOCS_HELP,
  keys: KEYS_HELP,
  config: CONFIG_HELP,
  logs: LOGS_HELP,
  jobs: JOBS_HELP,
  backups: BACKUPS_HELP,
  doctor: DOCTOR_HELP,
};

export async function run(argv: string[]): Promise<void> {
  const command = argv[0];

  if (command === '--help' || command === '-h') {
    console.log(MAIN_HELP);
    return;
  }

  if (!command) {
    await startDaemon(parseGlobalFlags(argv));
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  const rest = argv.slice(1);
  const isHelp = rest.includes('--help') || rest.includes('-h');

  if (command === '--verbose' || command === '--config' || command === '--no-color') {
    await startDaemon(parseGlobalFlags(argv));
    return;
  }

  switch (command as Command) {
    case COMMANDS.SESSIONS:
      if (isHelp) {
        console.log(COMMAND_HELP.sessions);
        return;
      }
      await handleSessions(rest);
      break;
    case COMMANDS.BIRDS:
      if (isHelp) {
        console.log(COMMAND_HELP.birds);
        return;
      }
      handleBirds(rest);
      break;
    case COMMANDS.DOCS:
      if (isHelp) {
        console.log(COMMAND_HELP.docs);
        return;
      }
      handleDocs(rest);
      break;
    case COMMANDS.KEYS:
      if (isHelp) {
        console.log(COMMAND_HELP.keys);
        return;
      }
      await handleKeys(rest);
      break;
    case COMMANDS.CONFIG:
      if (isHelp) {
        console.log(COMMAND_HELP.config);
        return;
      }
      handleConfig(rest);
      break;
    case COMMANDS.LOGS:
      if (isHelp) {
        console.log(COMMAND_HELP.logs);
        return;
      }
      handleLogs(rest);
      break;
    case COMMANDS.JOBS:
      if (isHelp) {
        console.log(COMMAND_HELP.jobs);
        return;
      }
      handleJobs(rest);
      break;
    case COMMANDS.BACKUPS:
      if (isHelp) {
        console.log(COMMAND_HELP.backups);
        return;
      }
      handleBackups(rest);
      break;
    case COMMANDS.DOCTOR:
      handleDoctor();
      break;
    default:
      unknownSubcommand(command, '', [
        'sessions',
        'birds',
        'docs',
        'keys',
        'config',
        'logs',
        'jobs',
        'backups',
        'doctor',
      ]);
  }
}

function parseGlobalFlags(argv: string[]): {
  flags: { verbose: boolean; config?: string; db?: string };
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      verbose: { type: 'boolean', default: false },
      config: { type: 'string' },
      db: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });
  if (values.verbose) logger.setLevel('debug');
  return {
    flags: {
      verbose: values.verbose as boolean,
      config: values.config as string | undefined,
      db: values.db as string | undefined,
    },
  };
}

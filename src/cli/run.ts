/** @fileoverview CLI entry point: argument parsing and command routing. */

import { parseArgs } from 'node:util';
import type { Command } from '../core/types.ts';
import { COMMANDS } from '../core/types.ts';
import { logger } from '../core/logger.ts';
import { startDaemon } from '../daemon.ts';
import { BANNER, VERSION } from './banner.ts';
import { c } from './style.ts';
import { handleSessions } from './sessions.ts';
import { SESSIONS_HELP } from './sessions.ts';
import { handleBirds } from './birds.ts';
import { BIRDS_HELP } from './birds.ts';
import { handleDatabase } from './database.ts';
import { DATABASE_HELP } from './database.ts';
import { handleConfig } from './config.ts';
import { CONFIG_HELP } from './config.ts';
import { handleDoctor } from './doctor.ts';
import { DOCTOR_HELP } from './doctor.ts';

const MAIN_HELP =
  BANNER +
  `
${c('cyan', 'usage:')} browserbird [command] [options]

${c('dim', 'commands:')}

  ${c('cyan', 'sessions')}    manage sessions
  ${c('cyan', 'birds')}       manage scheduled birds
  ${c('cyan', 'config')}      view configuration
  ${c('cyan', 'database')}    database maintenance and inspection
  ${c('cyan', 'doctor')}      check system dependencies

${c('dim', 'options:')}

  ${c('yellow', '-h, --help')}     show this help
  ${c('yellow', '-v, --version')}  show version
  ${c('yellow', '--verbose')}      enable debug logging
  ${c('yellow', '--config')}       config file path

run 'browserbird <command> --help' for command-specific options.`.trimEnd();

const COMMAND_HELP: Record<string, string> = {
  sessions: SESSIONS_HELP,
  birds: BIRDS_HELP,
  config: CONFIG_HELP,
  database: DATABASE_HELP,
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
      handleSessions(rest);
      break;
    case COMMANDS.BIRDS:
      if (isHelp) {
        console.log(COMMAND_HELP.birds);
        return;
      }
      handleBirds(rest);
      break;
    case COMMANDS.CONFIG:
      if (isHelp) {
        console.log(COMMAND_HELP.config);
        return;
      }
      handleConfig(rest);
      break;
    case COMMANDS.DATABASE:
      if (isHelp) {
        console.log(COMMAND_HELP.database);
        return;
      }
      handleDatabase(rest);
      break;
    case COMMANDS.DOCTOR:
      handleDoctor();
      break;
    default:
      logger.error(`unknown command: ${command}`);
      process.stderr.write(`run 'browserbird --help' for usage\n`);
      process.exitCode = 1;
  }
}

function parseGlobalFlags(argv: string[]): { flags: { verbose: boolean; config?: string } } {
  const { values } = parseArgs({
    args: argv,
    options: {
      verbose: { type: 'boolean', default: false },
      config: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });
  if (values.verbose) logger.setLevel('debug');
  return {
    flags: { verbose: values.verbose as boolean, config: values.config as string | undefined },
  };
}

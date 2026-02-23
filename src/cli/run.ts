/** @fileoverview CLI entry point — argument parsing and command routing. */

import { parseArgs } from 'node:util';
import type { Command } from '../core/types.ts';
import { COMMANDS } from '../core/types.ts';
import { logger } from '../core/logger.ts';
import { loadConfig } from '../config.ts';
import { startDaemon } from '../daemon.ts';
import { handleSessions } from './sessions.ts';
import { SESSIONS_HELP } from './sessions.ts';
import { handleBirds } from './birds.ts';
import { BIRDS_HELP } from './birds.ts';
import { handleDatabase } from './database.ts';
import { DATABASE_HELP } from './database.ts';
import { handleSettings } from './settings.ts';
import { SETTINGS_HELP } from './settings.ts';
import { handleDoctor } from './doctor.ts';
import { DOCTOR_HELP } from './doctor.ts';

const VERSION = '0.0.0';

const MAIN_HELP = `
usage: browserbird [command] [options]

commands:

  status      show daemon status
  sessions    manage claude sessions
  birds       manage scheduled birds
  settings    view configuration
  database    database maintenance and inspection
  doctor      check system dependencies

options:

  -h, --help     show this help
  -v, --version  show version
  --verbose      enable debug logging
  --config       config file path

run 'browserbird <command> --help' for command-specific options.
`.trim();

const COMMAND_HELP: Record<string, string> = {
  status: `
usage: browserbird status [options]

show daemon status (requires daemon to be running).

options:

  --config <path>   config file path
  -h, --help        show this help
`.trim(),
  sessions: SESSIONS_HELP,
  birds: BIRDS_HELP,
  settings: SETTINGS_HELP,
  database: DATABASE_HELP,
  doctor: DOCTOR_HELP,
};

export async function run(argv: string[]): Promise<void> {
  const command = argv[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(MAIN_HELP);
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
    case COMMANDS.START:
      await startDaemon(parseGlobalFlags(argv));
      break;
    case COMMANDS.STOP:
      logger.info(`command "${command}" not yet implemented`);
      break;
    case COMMANDS.STATUS:
      if (isHelp) { console.log(COMMAND_HELP.status); return; }
      await handleStatus(rest);
      break;
    case COMMANDS.SESSIONS:
      if (isHelp) { console.log(COMMAND_HELP.sessions); return; }
      handleSessions(rest);
      break;
    case COMMANDS.BIRDS:
      if (isHelp) { console.log(COMMAND_HELP.birds); return; }
      handleBirds(rest);
      break;
    case COMMANDS.SETTINGS:
      if (isHelp) { console.log(COMMAND_HELP.settings); return; }
      handleSettings(rest);
      break;
    case COMMANDS.DATABASE:
      if (isHelp) { console.log(COMMAND_HELP.database); return; }
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
  return { flags: { verbose: values.verbose as boolean, config: values.config as string | undefined } };
}

async function handleStatus(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { config: { type: 'string' } },
    allowPositionals: false,
    strict: false,
  });

  const config = loadConfig(values.config as string | undefined);
  const url = `http://${config.web.host}:${config.web.port}/api/status`;

  const headers: Record<string, string> = {};
  if (config.web.authToken) {
    headers['Authorization'] = `Bearer ${config.web.authToken}`;
  }

  let body: string;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      logger.error(`daemon returned HTTP ${res.status}`);
      process.exitCode = 1;
      return;
    }
    body = await res.text();
  } catch {
    logger.error(`daemon not reachable at ${url} - is it running?`);
    process.exitCode = 1;
    return;
  }

  const data = JSON.parse(body) as {
    uptime: number;
    sessions: { active: number; maxConcurrent: number };
    jobs: { pending: number; running: number; completed: number; failed: number };
    slack: { connected: boolean };
    messages: { totalMessages: number; totalTokensIn: number; totalTokensOut: number };
  };

  const uptimeHours = Math.floor(data.uptime / 3600);
  const uptimeMins = Math.floor((data.uptime % 3600) / 60);
  const uptimeSecs = data.uptime % 60;
  const uptimeStr =
    uptimeHours > 0
      ? `${uptimeHours}h ${uptimeMins}m`
      : uptimeMins > 0
        ? `${uptimeMins}m ${uptimeSecs}s`
        : `${uptimeSecs}s`;

  console.log('browserbird status');
  console.log('------------------');
  console.log(`uptime:    ${uptimeStr}`);
  console.log(`slack:     ${data.slack.connected ? 'connected' : 'disconnected'}`);
  console.log(`sessions:  ${data.sessions.active} / ${data.sessions.maxConcurrent} active`);
  console.log(`jobs:      ${data.jobs.pending} pending  ${data.jobs.running} running  ${data.jobs.completed} done  ${data.jobs.failed} failed`);
  console.log(`messages:  ${data.messages.totalMessages} total`);
  console.log(`tokens:    ${(data.messages.totalTokensIn + data.messages.totalTokensOut).toLocaleString()} (${data.messages.totalTokensIn.toLocaleString()} in / ${data.messages.totalTokensOut.toLocaleString()} out)`);
}

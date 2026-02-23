/** @fileoverview CLI argument parsing and command routing. */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { Command } from './core/types.ts';
import { COMMANDS } from './core/types.ts';
import { logger } from './core/logger.ts';
import { loadConfig } from './config.ts';
import { startDaemon } from './daemon.ts';
import {
  openDatabase,
  closeDatabase,
  deleteOldMessages,
  deleteOldCronRuns,
  optimizeDatabase,
  listJobs,
  getJobStats,
  retryJob,
  retryAllFailedJobs,
  deleteJob,
  clearJobs,
  listCronJobs,
  createCronJob,
  getCronJob,
  updateCronJob,
  setCronJobEnabled,
  deleteCronJob,
  getSession,
  getSessionMessages,
  getSessionTokenStats,
  getRecentLogs,
} from './db.ts';
import { execFileSync } from 'node:child_process';
import { enqueue } from './jobs.ts';
import { printTable, unknownSubcommand } from './core/table.ts';

const VERSION = '0.0.0';

const MAIN_HELP = `
usage: browserbird [command] [options]

commands:

  birds       manage scheduled birds
  sessions    manage claude sessions
  jobs        manage background jobs
  logs        show recent log entries
  status      show daemon status
  db          database maintenance
  doctor      check system dependencies

options:

  -h, --help     show this help
  -v, --version  show version
  --verbose      enable debug logging
  --config       config file path

run 'browserbird <command> --help' for command-specific options.
`.trim();

const COMMAND_HELP: Record<string, string> = {
  birds: `
usage: browserbird birds <subcommand> [options]

manage scheduled birds.

subcommands:

  list                         list all birds
  add <schedule> <prompt>      add a new bird
  edit <id>                    edit a bird
  remove <id>                  remove a bird
  enable <id>                  enable a bird
  disable <id>                 disable a bird
  fly <id>                     trigger a bird manually

options:

  --channel <id>    target slack channel
  --agent <id>      target agent id
  --schedule <expr> cron schedule expression
  --prompt <text>   prompt text
  -h, --help        show this help
`.trim(),

  sessions: `
usage: browserbird sessions <subcommand> [options]

manage claude sessions.

subcommands:

  inspect <id>   show session detail and message history

options:

  -h, --help   show this help
`.trim(),

  jobs: `
usage: browserbird jobs <subcommand> [options]

manage background jobs.

subcommands:

  list              list all jobs
  stats             show job queue statistics
  retry <id>        retry a failed job
  delete <id>       delete a job
  clear             clear completed or failed jobs

options:

  --status <s>     filter by status: pending, running, completed, failed
  --all-failed     retry all failed jobs (with retry)
  --completed      clear completed jobs (with clear)
  --failed         clear failed jobs (with clear)
  -h, --help       show this help
`.trim(),

  logs: `
usage: browserbird logs [options]

show recent log entries from the database.

options:

  --level <lvl>   filter by level: debug, info, warn, error
  --limit <n>     number of entries to show (default: 20)
  -h, --help      show this help
`.trim(),

  status: `
usage: browserbird status [options]

show daemon status (requires daemon to be running).

options:

  --config <path>   config file path
  -h, --help        show this help
`.trim(),

  db: `
usage: browserbird db <subcommand> [options]

database maintenance.

subcommands:

  cleanup   delete old records and optimize

options:

  --days <n>      retention days (overrides config)
  --config <path> config file path
  -h, --help      show this help
`.trim(),

  doctor: `
usage: browserbird doctor

check system dependencies (claude cli, node.js).

options:

  -h, --help   show this help
`.trim(),
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

  if (command === '--verbose') {
    logger.setLevel('debug');
  }

  const rest = argv.slice(1);
  const isHelp = rest.includes('--help') || rest.includes('-h');

  if (command === '--verbose' || command === '--config' || command === '--no-color') {
    await startDaemon(parseGlobalFlags(argv));
    return;
  }

  switch (command as Command) {
    case COMMANDS.DOCTOR:
      if (isHelp) { console.log(COMMAND_HELP.doctor); return; }
      handleDoctor();
      break;
    case COMMANDS.DB:
      if (isHelp) { console.log(COMMAND_HELP.db); return; }
      handleDb(rest);
      break;
    case COMMANDS.JOBS:
      if (isHelp) { console.log(COMMAND_HELP.jobs); return; }
      handleJobs(rest);
      break;
    case COMMANDS.BIRDS:
      if (isHelp) { console.log(COMMAND_HELP.birds); return; }
      handleCron(rest);
      break;
    case COMMANDS.START:
      await startDaemon(parseGlobalFlags(argv));
      break;
    case COMMANDS.STOP:
    case COMMANDS.AGENTS:
    case COMMANDS.CONFIG:
      logger.info(`command "${command}" not yet implemented`);
      break;
    case COMMANDS.LOGS:
      if (isHelp) { console.log(COMMAND_HELP.logs); return; }
      handleLogs(rest);
      break;
    case COMMANDS.STATUS:
      if (isHelp) { console.log(COMMAND_HELP.status); return; }
      await handleStatus(rest);
      break;
    case COMMANDS.SESSIONS:
      if (isHelp) { console.log(COMMAND_HELP.sessions); return; }
      handleSessions(rest);
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

function handleSessions(argv: string[]): void {
  const subcommand = argv[0];
  const args = argv.slice(1);

  if (subcommand !== 'inspect') {
    if (subcommand) {
      unknownSubcommand(subcommand, 'sessions');
    } else {
      console.log(COMMAND_HELP.sessions);
    }
    return;
  }

  const { values, positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
    strict: false,
  });
  void values;

  const id = Number(positionals[0]);
  if (!Number.isFinite(id)) {
    logger.error('usage: browserbird sessions inspect <id>');
    process.exitCode = 1;
    return;
  }

  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);

  try {
    const session = getSession(id);
    if (!session) {
      logger.error(`session #${id} not found`);
      process.exitCode = 1;
      return;
    }

    const tokenStats = getSessionTokenStats(session.slack_channel_id, session.slack_thread_ts);

    console.log(`session #${id}`);
    console.log('------------------');
    console.log(`channel:      ${session.slack_channel_id}`);
    console.log(`thread:       ${session.slack_thread_ts ?? '(none)'}`);
    console.log(`agent:        ${session.agent_id}`);
    console.log(`provider id:  ${session.provider_session_id}`);
    console.log(`created:      ${session.created_at}`);
    console.log(`last active:  ${session.last_active}`);
    console.log(`messages:     ${session.message_count}`);
    console.log(`tokens:       ${tokenStats.totalTokensIn} in / ${tokenStats.totalTokensOut} out`);
    console.log('');

    const result = getSessionMessages(session.slack_channel_id, session.slack_thread_ts, 1, 50);

    if (result.items.length === 0) {
      console.log('no messages recorded.');
      return;
    }

    console.log(`messages (${result.totalItems} total, showing page 1 of ${result.totalPages}):`);
    console.log('------------------');

    for (const msg of result.items) {
      const dir = msg.direction === 'in' ? '->' : '<-';
      const tokens =
        msg.tokens_in != null || msg.tokens_out != null
          ? `  [in:${msg.tokens_in ?? 0} out:${msg.tokens_out ?? 0}]`
          : '';
      const preview = (msg.content ?? '').slice(0, 120);
      const truncated = (msg.content?.length ?? 0) > 120 ? '...' : '';
      console.log(`${dir} ${msg.slack_user_id}  ${msg.created_at}${tokens}`);
      if (preview) console.log(`   ${preview}${truncated}`);
    }
  } finally {
    closeDatabase();
  }
}

export interface DoctorResult {
  claude: { available: boolean; version: string | null };
  node: string;
}

export function checkDoctor(): DoctorResult {
  try {
    const output = execFileSync('claude', ['--version'], {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const version = output.trim().split('\n')[0] ?? null;
    return { claude: { available: true, version }, node: process.version };
  } catch {
    return { claude: { available: false, version: null }, node: process.version };
  }
}

function handleDoctor(): void {
  const result = checkDoctor();

  console.log('browserbird doctor');
  console.log('------------------');

  if (result.claude.available) {
    logger.success(`claude cli: ${result.claude.version}`);
  } else {
    logger.error('claude cli: not found');
    process.stderr.write('  install: npm install -g @anthropic-ai/claude-code\n');
  }

  logger.success(`node.js: ${result.node}`);
}

function handleLogs(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      level: { type: 'string' },
      limit: { type: 'string' },
    },
    allowPositionals: false,
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
    const result = getRecentLogs(1, perPage, level);

    if (result.items.length === 0) {
      logger.info('no log entries found');
      return;
    }

    console.log(`logs (${result.totalItems} total, showing ${result.items.length}):`);
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

function handleDb(argv: string[]): void {
  const subcommand = argv[0];
  const rest = argv.slice(1);

  if (subcommand !== 'cleanup') {
    if (subcommand) {
      unknownSubcommand(subcommand, 'db');
    } else {
      console.log(COMMAND_HELP.db);
    }
    return;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      days: { type: 'string' },
      config: { type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  });

  const config = loadConfig(values.config as string | undefined);
  const envDays = process.env['BROWSERBIRD_RETENTION_DAYS'];
  const days =
    values.days != null
      ? Number(values.days)
      : envDays != null
        ? Number(envDays)
        : config.database.retentionDays;

  if (!Number.isFinite(days) || days < 1) {
    logger.error('--days must be a positive number');
    process.exitCode = 1;
    return;
  }

  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);
  const msgs = deleteOldMessages(days);
  const runs = deleteOldCronRuns(days);
  optimizeDatabase();
  closeDatabase();

  logger.success(`cleaned up: ${msgs} messages, ${runs} flight logs older than ${days}d`);
}

function handleJobs(argv: string[]): void {
  const subcommand = argv[0] ?? 'list';
  const rest = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      status: { type: 'string' },
      'all-failed': { type: 'boolean', default: false },
      completed: { type: 'boolean', default: false },
      failed: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);

  try {
    switch (subcommand) {
      case 'list': {
        const result = listJobs(1, 100, { status: values.status as string | undefined });
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
        printTable(['id', 'status', 'name', 'attempts', 'created', 'error'], rows, [undefined, undefined, 30, undefined, undefined, 40]);
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
        const id = Number(positionals[0]);
        if (!Number.isFinite(id)) {
          logger.error('usage: browserbird jobs retry <id> | --all-failed');
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
        const id = Number(positionals[0]);
        if (!Number.isFinite(id)) {
          logger.error('usage: browserbird jobs delete <id>');
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
          logger.error('usage: browserbird jobs clear --completed | --failed');
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
        unknownSubcommand(subcommand, 'jobs');
    }
  } finally {
    closeDatabase();
  }
}

function handleCron(argv: string[]): void {
  const subcommand = argv[0] ?? 'list';
  const rest = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      channel: { type: 'string' },
      agent: { type: 'string' },
      schedule: { type: 'string' },
      prompt: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);

  try {
    switch (subcommand) {
      case 'list': {
        const result = listCronJobs(1, 100);
        console.log(`birds (${result.totalItems} total):`);
        if (result.items.length === 0) {
          console.log('\n  no birds configured');
          return;
        }
        console.log('');
        const rows = result.items.map((job) => [
          String(job.id),
          job.enabled ? 'enabled' : 'disabled',
          job.schedule,
          job.agent_id,
          job.target_channel_id ?? '-',
          job.last_status ?? '-',
          job.prompt.slice(0, 50),
        ]);
        printTable(['id', 'status', 'schedule', 'agent', 'channel', 'last', 'prompt'], rows, [undefined, undefined, undefined, undefined, undefined, undefined, 50]);
        break;
      }

      case 'add': {
        const schedule = positionals[0];
        const prompt = positionals.slice(1).join(' ') || (values.prompt as string | undefined);
        if (!schedule || !prompt) {
          logger.error('usage: browserbird birds add <schedule> <prompt> [--channel <id>] [--agent <id>]');
          process.exitCode = 1;
          return;
        }
        const job = createCronJob(prompt.slice(0, 50), schedule, prompt, values.channel as string | undefined, values.agent as string | undefined);
        logger.success(`bird #${job.id} created: "${schedule}"`);
        break;
      }

      case 'edit': {
        const id = Number(positionals[0]);
        if (!Number.isFinite(id)) {
          logger.error('usage: browserbird birds edit <id> [--schedule <expr>] [--prompt <text>] [--channel <id>] [--agent <id>]');
          process.exitCode = 1;
          return;
        }
        const channel = values.channel as string | undefined;
        const agent = values.agent as string | undefined;
        const schedule = values.schedule as string | undefined;
        const prompt = values.prompt as string | undefined;
        if (!schedule && !prompt && !channel && !agent) {
          logger.error('provide at least one of: --schedule, --prompt, --channel, --agent');
          process.exitCode = 1;
          return;
        }
        const updated = updateCronJob(id, {
          schedule,
          prompt,
          name: prompt ? prompt.slice(0, 50) : undefined,
          targetChannelId: channel !== undefined ? channel || null : undefined,
          agentId: agent,
        });
        if (updated) {
          logger.success(`bird #${id} updated`);
        } else {
          logger.error(`bird #${id} not found`);
          process.exitCode = 1;
        }
        break;
      }

      case 'remove': {
        const id = Number(positionals[0]);
        if (!Number.isFinite(id)) {
          logger.error('usage: browserbird birds remove <id>');
          process.exitCode = 1;
          return;
        }
        if (deleteCronJob(id)) {
          logger.success(`bird #${id} removed`);
        } else {
          logger.error(`bird #${id} not found`);
          process.exitCode = 1;
        }
        break;
      }

      case 'enable':
      case 'disable': {
        const id = Number(positionals[0]);
        if (!Number.isFinite(id)) {
          logger.error(`usage: browserbird birds ${subcommand} <id>`);
          process.exitCode = 1;
          return;
        }
        const enabled = subcommand === 'enable';
        if (setCronJobEnabled(id, enabled)) {
          logger.success(`bird #${id} ${enabled ? 'enabled' : 'disabled'}`);
        } else {
          logger.error(`bird #${id} not found`);
          process.exitCode = 1;
        }
        break;
      }

      case 'fly': {
        const id = Number(positionals[0]);
        if (!Number.isFinite(id)) {
          logger.error('usage: browserbird birds fly <id>');
          process.exitCode = 1;
          return;
        }
        const cronJob = getCronJob(id);
        if (!cronJob) {
          logger.error(`bird #${id} not found`);
          process.exitCode = 1;
          return;
        }
        const enqueuedJob = enqueue(
          'cron_run',
          {
            cronJobId: cronJob.id,
            prompt: cronJob.prompt,
            channelId: cronJob.target_channel_id,
            agentId: cronJob.agent_id,
          },
          { cronJobId: cronJob.id },
        );
        logger.success(`enqueued job #${enqueuedJob.id} for bird #${id}`);
        break;
      }

      default:
        unknownSubcommand(subcommand, 'birds');
    }
  } finally {
    closeDatabase();
  }
}

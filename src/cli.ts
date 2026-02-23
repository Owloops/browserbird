/** @fileoverview CLI argument parsing and command routing. */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import type { CliOptions, Command } from './core/types.ts';
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

const VERSION = '0.0.0';

const HELP = `
Usage: browserbird [command] [options]

Commands:
  (none)              Start orchestrator (foreground)
  start               Start as background daemon
  stop                Graceful shutdown
  status              Show running sessions, uptime, stats
  logs [--level <lvl>] [--limit <n>]  Show recent errors from database

  sessions                    List active Claude sessions
  sessions inspect <id>       Show session detail and message history
  sessions kill <id>          Terminate a session

  birds list           List scheduled birds
  birds add <schedule> <prompt> [--channel <id>] [--agent <id>]
  birds edit <id>      Edit a bird [--schedule] [--prompt] [--channel] [--agent]
  birds remove <id>    Remove a bird
  birds enable <id>    Enable a bird
  birds disable <id>   Disable a bird
  birds fly <id>       Trigger a bird manually

  agents              List configured agents
  config              Show current config
  config set <k> <v>  Update config value

  doctor              Check system dependencies (Claude CLI, etc.)

  db cleanup [--days]  Delete old entries, optimize database

  jobs                List all jobs
  jobs stats          Show job queue statistics
  jobs retry <id>     Retry a failed job
  jobs retry --all-failed  Retry all failed jobs
  jobs delete <id>    Delete a job
  jobs clear          Clear completed or failed jobs

Options:
  -h, --help          Show this help
  -v, --version       Show version
  -f, --follow        Follow log output
  --verbose           Enable debug logging
  --no-color          Disable colored output
  --channel <id>      Target channel for birds
  --agent <id>        Target agent for birds
  --schedule <expr>   Cron schedule expression (for birds edit)
  --prompt <text>     Prompt text (for birds edit)
  --days <n>          Retention days for db cleanup (overrides config)
  --level <lvl>       Filter logs by level: debug, info, warn, error
  --limit <n>         Number of log entries to show (default: 20)
  --config <path>     Config file path (default: ./browserbird.json)

Environment:
  SLACK_BOT_TOKEN     Bot user OAuth token (or set in browserbird.json)
  SLACK_APP_TOKEN     App-level token for Socket Mode (or set in browserbird.json)
  BROWSERBIRD_RETENTION_DAYS  Override database.retentionDays
  BROWSERBIRD_MCP_CONFIG_PATH Override browser.mcpConfigPath
  NO_COLOR            Disable colored output (any value)
`.trim();

export function parseCli(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      follow: { type: 'boolean', short: 'f', default: false },
      verbose: { type: 'boolean', default: false },
      channel: { type: 'string' },
      agent: { type: 'string' },
      schedule: { type: 'string' },
      prompt: { type: 'string' },
      days: { type: 'string' },
      status: { type: 'string' },
      level: { type: 'string' },
      limit: { type: 'string' },
      'all-failed': { type: 'boolean', default: false },
      completed: { type: 'boolean', default: false },
      failed: { type: 'boolean', default: false },
      config: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const command = (positionals[0] as Command | undefined) ?? undefined;
  const subcommand = positionals[1] ?? undefined;
  const args = positionals.slice(2);

  return {
    command,
    subcommand,
    args,
    flags: {
      help: values.help as boolean,
      version: values.version as boolean,
      follow: values.follow as boolean,
      verbose: values.verbose as boolean,
      channel: values.channel as string | undefined,
      agent: values.agent as string | undefined,
      schedule: values.schedule as string | undefined,
      prompt: values.prompt as string | undefined,
      days: values.days as string | undefined,
      status: values.status as string | undefined,
      level: values.level as string | undefined,
      limit: values.limit as string | undefined,
      allFailed: values['all-failed'] as boolean,
      completed: values.completed as boolean,
      failed: values.failed as boolean,
      config: values.config as string | undefined,
    },
  };
}

export async function run(argv: string[]): Promise<void> {
  const options = parseCli(argv);

  if (options.flags.help) {
    console.log(HELP);
    return;
  }

  if (options.flags.version) {
    console.log(VERSION);
    return;
  }

  if (options.flags.verbose) {
    logger.setLevel('debug');
  }

  const { command } = options;

  if (!command) {
    await startDaemon(options);
    return;
  }

  switch (command) {
    case COMMANDS.DOCTOR:
      handleDoctor();
      break;
    case COMMANDS.DB:
      handleDb(options);
      break;
    case COMMANDS.JOBS:
      handleJobs(options);
      break;
    case COMMANDS.BIRDS:
      handleCron(options);
      break;
    case COMMANDS.START:
      await startDaemon(options);
      break;
    case COMMANDS.STOP:
    case COMMANDS.AGENTS:
    case COMMANDS.CONFIG:
      logger.info(`command "${command}" not yet implemented`);
      break;
    case COMMANDS.LOGS:
      handleLogs(options);
      break;
    case COMMANDS.STATUS:
      await handleStatus(options);
      break;
    case COMMANDS.SESSIONS:
      handleSessions(options);
      break;
    default:
      logger.error(`unknown command: ${command}`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

function handleSessions(options: CliOptions): void {
  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);

  try {
    const { subcommand, args } = options;

    if (subcommand !== 'inspect') {
      logger.error(
        `unknown sessions subcommand: ${subcommand ?? '(none)'}. Try: sessions inspect <id>`,
      );
      process.exitCode = 1;
      return;
    }

    const id = Number(args[0]);
    if (!Number.isFinite(id)) {
      logger.error('usage: browserbird sessions inspect <id>');
      process.exitCode = 1;
      return;
    }

    const session = getSession(id);
    if (!session) {
      logger.error(`session #${id} not found`);
      process.exitCode = 1;
      return;
    }

    const tokenStats = getSessionTokenStats(session.slack_channel_id, session.slack_thread_ts);

    console.log('Session Detail');
    console.log('──────────────────');
    console.log(`ID:            ${session.id}`);
    console.log(`Channel:       ${session.slack_channel_id}`);
    console.log(`Thread:        ${session.slack_thread_ts ?? '(none)'}`);
    console.log(`Agent:         ${session.agent_id}`);
    console.log(`Provider ID:   ${session.provider_session_id}`);
    console.log(`Created:       ${session.created_at}`);
    console.log(`Last Active:   ${session.last_active}`);
    console.log(`Messages:      ${session.message_count}`);
    console.log(`Tokens In:     ${tokenStats.totalTokensIn}`);
    console.log(`Tokens Out:    ${tokenStats.totalTokensOut}`);
    console.log('');

    const result = getSessionMessages(session.slack_channel_id, session.slack_thread_ts, 1, 50);

    if (result.items.length === 0) {
      console.log('No messages recorded.');
      return;
    }

    console.log(
      `Messages (${result.totalItems} total, showing page 1 of ${result.totalPages}):`,
    );
    console.log('──────────────────');

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

  console.log('BrowserBird Doctor');
  console.log('──────────────────');

  if (result.claude.available) {
    logger.success(`Claude CLI: ${result.claude.version}`);
  } else {
    logger.error('Claude CLI: not found');
    console.log('  Install: npm install -g @anthropic-ai/claude-code');
  }

  logger.success(`Node.js: ${result.node}`);
}

function handleLogs(options: CliOptions): void {
  const { level, limit } = options.flags;
  const perPage = limit != null ? Number(limit) : 20;

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

    for (const entry of result.items) {
      const time = entry.created_at.slice(11, 19);
      const src = entry.source.padEnd(10);
      console.log(`${time}  [${entry.level.padEnd(5)}]  ${src}  ${entry.message}`);
    }
  } finally {
    closeDatabase();
  }
}

async function handleStatus(options: CliOptions): Promise<void> {
  const config = loadConfig(options.flags.config);
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
    logger.error(`daemon not reachable at ${url} — is it running?`);
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

  console.log('BrowserBird Status');
  console.log('──────────────────');
  console.log(`Uptime:        ${uptimeStr}`);
  console.log(`Slack:         ${data.slack.connected ? 'connected' : 'disconnected'}`);
  console.log(`Sessions:      ${data.sessions.active} / ${data.sessions.maxConcurrent} active`);
  console.log(
    `Jobs:          ${data.jobs.pending} pending, ${data.jobs.running} running, ${data.jobs.completed} done, ${data.jobs.failed} failed`,
  );
  console.log(`Messages:      ${data.messages.totalMessages} total`);
  console.log(
    `Tokens:        ${(data.messages.totalTokensIn + data.messages.totalTokensOut).toLocaleString()} (${data.messages.totalTokensIn.toLocaleString()} in / ${data.messages.totalTokensOut.toLocaleString()} out)`,
  );
}

function handleDb(options: CliOptions): void {
  if (options.subcommand !== 'cleanup') {
    logger.error('usage: browserbird db cleanup [--days <n>]');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(options.flags.config);
  const envDays = process.env['BROWSERBIRD_RETENTION_DAYS'];
  const days =
    options.flags.days != null
      ? Number(options.flags.days)
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

function handleJobs(options: CliOptions): void {
  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);

  try {
    const { subcommand, args, flags } = options;

    switch (subcommand) {
      case undefined:
      case 'list': {
        const result = listJobs(1, 100, { status: flags.status });
        if (result.items.length === 0) {
          logger.info('no jobs found');
          return;
        }
        for (const job of result.items) {
          const age = job.created_at;
          const err = job.error ? ` error="${job.error}"` : '';
          console.log(
            `#${job.id}  ${job.status.padEnd(9)}  ${job.name}  attempts=${job.attempts}/${job.max_attempts}  ${age}${err}`,
          );
        }
        break;
      }

      case 'stats': {
        const stats = getJobStats();
        console.log(`pending:   ${stats.pending}`);
        console.log(`running:   ${stats.running}`);
        console.log(`completed: ${stats.completed}`);
        console.log(`failed:    ${stats.failed}`);
        console.log(`total:     ${stats.total}`);
        break;
      }

      case 'retry': {
        if (flags.allFailed) {
          const count = retryAllFailedJobs();
          logger.success(`reset ${count} failed job(s) to pending`);
          return;
        }
        const id = Number(args[0]);
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
        const id = Number(args[0]);
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
        if (!flags.completed && !flags.failed) {
          logger.error('usage: browserbird jobs clear --completed | --failed');
          process.exitCode = 1;
          return;
        }
        let total = 0;
        if (flags.completed) total += clearJobs('completed');
        if (flags.failed) total += clearJobs('failed');
        logger.success(`cleared ${total} job(s)`);
        break;
      }

      default:
        logger.error(`unknown jobs subcommand: ${subcommand}`);
        process.exitCode = 1;
    }
  } finally {
    closeDatabase();
  }
}

function handleCron(options: CliOptions): void {
  const dbPath = resolve('.browserbird', 'browserbird.db');
  openDatabase(dbPath);

  try {
    const { subcommand, args, flags } = options;

    switch (subcommand) {
      case undefined:
      case 'list': {
        const result = listCronJobs(1, 100);
        if (result.items.length === 0) {
          logger.info('no birds configured');
          return;
        }
        for (const job of result.items) {
          const status = job.enabled ? 'enabled' : 'disabled';
          const last = job.last_run ? `  last=${job.last_run} (${job.last_status})` : '';
          const channel = job.target_channel_id ? `  channel=${job.target_channel_id}` : '';
          console.log(
            `#${job.id}  [${status}]  "${job.schedule}"  agent=${job.agent_id}${channel}${last}`,
          );
          console.log(`    ${job.prompt}`);
        }
        break;
      }

      case 'add': {
        const schedule = args[0];
        const prompt = args.slice(1).join(' ');
        if (!schedule || !prompt) {
          logger.error(
            'usage: browserbird birds add <schedule> <prompt> [--channel <id>] [--agent <id>]',
          );
          process.exitCode = 1;
          return;
        }
        const name = prompt.slice(0, 50);
        const job = createCronJob(name, schedule, prompt, flags.channel, flags.agent);
        logger.success(`bird #${job.id} created: "${schedule}"`);
        break;
      }

      case 'edit': {
        const id = Number(args[0]);
        if (!Number.isFinite(id)) {
          logger.error(
            'usage: browserbird birds edit <id> [--schedule <expr>] [--prompt <text>] [--channel <id>] [--agent <id>]',
          );
          process.exitCode = 1;
          return;
        }
        if (!flags.schedule && !flags.prompt && !flags.channel && !flags.agent) {
          logger.error('provide at least one of: --schedule, --prompt, --channel, --agent');
          process.exitCode = 1;
          return;
        }
        const updated = updateCronJob(id, {
          schedule: flags.schedule,
          prompt: flags.prompt,
          name: flags.prompt ? flags.prompt.slice(0, 50) : undefined,
          targetChannelId: flags.channel !== undefined ? flags.channel || null : undefined,
          agentId: flags.agent,
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
        const id = Number(args[0]);
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
        const id = Number(args[0]);
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
        const id = Number(args[0]);
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
        logger.error(`unknown birds subcommand: ${subcommand}`);
        process.exitCode = 1;
    }
  } finally {
    closeDatabase();
  }
}

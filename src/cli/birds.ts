/** @fileoverview Birds command — manage scheduled birds (cron jobs). */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { logger } from '../core/logger.ts';
import { printTable, unknownSubcommand } from '../core/table.ts';
import {
  openDatabase,
  closeDatabase,
  listCronJobs,
  createCronJob,
  getCronJob,
  updateCronJob,
  setCronJobEnabled,
  deleteCronJob,
  listFlights,
} from '../db/index.ts';
import { enqueue } from '../jobs.ts';

export const BIRDS_HELP = `
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
  logs <id>                    show flight history for a bird

options:

  --channel <id>       target slack channel
  --agent <id>         target agent id
  --schedule <expr>    cron schedule expression
  --prompt <text>      prompt text
  --timezone <tz>      IANA timezone (default: UTC)
  --active-hours <range>  restrict runs to a time window (e.g. "09:00-17:00")
  --limit <n>          number of flights to show (default: 10, with logs)
  -h, --help           show this help
`.trim();

function parseActiveHours(raw: string): { start: string; end: string } | null {
  const match = raw.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!match) return null;
  return { start: match[1]!, end: match[2]! };
}

export function handleBirds(argv: string[]): void {
  const subcommand = argv[0] ?? 'list';
  const rest = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      channel: { type: 'string' },
      agent: { type: 'string' },
      schedule: { type: 'string' },
      prompt: { type: 'string' },
      timezone: { type: 'string' },
      'active-hours': { type: 'string' },
      limit: { type: 'string' },
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
        printTable(['id', 'status', 'schedule', 'agent', 'channel', 'last', 'prompt'], rows, [
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          50,
        ]);
        break;
      }

      case 'add': {
        const schedule = positionals[0];
        const prompt = positionals.slice(1).join(' ') || (values.prompt as string | undefined);
        if (!schedule || !prompt) {
          logger.error(
            'usage: browserbird birds add <schedule> <prompt> [--channel <id>] [--agent <id>]',
          );
          process.exitCode = 1;
          return;
        }
        const activeHoursRaw = values['active-hours'] as string | undefined;
        let activeStart: string | undefined;
        let activeEnd: string | undefined;
        if (activeHoursRaw) {
          const parsed = parseActiveHours(activeHoursRaw);
          if (!parsed) {
            logger.error('--active-hours must be HH:MM-HH:MM (e.g. "09:00-17:00")');
            process.exitCode = 1;
            return;
          }
          activeStart = parsed.start;
          activeEnd = parsed.end;
        }
        const job = createCronJob(
          prompt.slice(0, 50),
          schedule,
          prompt,
          values.channel as string | undefined,
          values.agent as string | undefined,
          values.timezone as string | undefined,
          activeStart,
          activeEnd,
        );
        logger.success(`bird #${job.id} created: "${schedule}"`);
        break;
      }

      case 'edit': {
        const id = Number(positionals[0]);
        if (!Number.isFinite(id)) {
          logger.error(
            'usage: browserbird birds edit <id> [--schedule <expr>] [--prompt <text>] [--channel <id>] [--agent <id>] [--timezone <tz>] [--active-hours <range>]',
          );
          process.exitCode = 1;
          return;
        }
        const channel = values.channel as string | undefined;
        const agent = values.agent as string | undefined;
        const schedule = values.schedule as string | undefined;
        const prompt = values.prompt as string | undefined;
        const timezone = values.timezone as string | undefined;
        const editActiveHoursRaw = values['active-hours'] as string | undefined;
        let editActiveStart: string | null | undefined;
        let editActiveEnd: string | null | undefined;
        if (editActiveHoursRaw === '') {
          editActiveStart = null;
          editActiveEnd = null;
        } else if (editActiveHoursRaw) {
          const parsed = parseActiveHours(editActiveHoursRaw);
          if (!parsed) {
            logger.error('--active-hours must be HH:MM-HH:MM (e.g. "09:00-17:00"), or "" to clear');
            process.exitCode = 1;
            return;
          }
          editActiveStart = parsed.start;
          editActiveEnd = parsed.end;
        }
        if (
          !schedule &&
          !prompt &&
          !channel &&
          !agent &&
          !timezone &&
          editActiveStart === undefined
        ) {
          logger.error(
            'provide at least one of: --schedule, --prompt, --channel, --agent, --timezone, --active-hours',
          );
          process.exitCode = 1;
          return;
        }
        const updated = updateCronJob(id, {
          schedule,
          prompt,
          name: prompt ? prompt.slice(0, 50) : undefined,
          targetChannelId: channel !== undefined ? channel || null : undefined,
          agentId: agent,
          timezone,
          activeHoursStart: editActiveStart,
          activeHoursEnd: editActiveEnd,
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

      case 'logs': {
        const id = Number(positionals[0]);
        if (!Number.isFinite(id)) {
          logger.error('usage: browserbird birds logs <id>');
          process.exitCode = 1;
          return;
        }
        const perPage = values.limit != null ? Number(values.limit) : 10;
        if (!Number.isFinite(perPage) || perPage < 1) {
          logger.error('--limit must be a positive number');
          process.exitCode = 1;
          return;
        }
        const result = listFlights(1, perPage, { birdId: id });
        console.log(`flight history for bird #${id} (${result.totalItems} total):`);
        if (result.items.length === 0) {
          console.log('\n  no flights recorded');
          return;
        }
        console.log('');
        const rows = result.items.map((flight) => {
          const durationMs = flight.finished_at
            ? new Date(flight.finished_at).getTime() - new Date(flight.started_at).getTime()
            : null;
          const duration =
            durationMs == null
              ? '-'
              : durationMs >= 60_000
                ? `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1000)}s`
                : `${Math.round(durationMs / 1000)}s`;
          return [
            String(flight.id),
            flight.status,
            duration,
            flight.started_at.slice(0, 19),
            flight.error ?? flight.result?.slice(0, 60) ?? '',
          ];
        });
        printTable(['flight', 'status', 'duration', 'started', 'error / result'], rows, [
          undefined,
          undefined,
          undefined,
          undefined,
          60,
        ]);
        break;
      }

      default:
        unknownSubcommand(subcommand, 'birds');
    }
  } finally {
    closeDatabase();
  }
}

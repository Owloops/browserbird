/** @fileoverview Birds command: manage scheduled birds (cron jobs). */

import { parseArgs } from 'node:util';
import { logger } from '../core/logger.ts';
import { shortUid } from '../core/uid.ts';
import { formatDuration, deriveBirdName, printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import {
  openDatabase,
  closeDatabase,
  resolveByUid,
  listCronJobs,
  createCronJob,
  updateCronJob,
  setCronJobEnabled,
  deleteCronJob,
  listFlights,
  resolveDbPathFromArgv,
} from '../db/index.ts';
import type { CronJobRow } from '../db/index.ts';
import { enqueue } from '../jobs.ts';

export const BIRDS_HELP = `
${c('cyan', 'usage:')} browserbird birds <subcommand> [options]

manage scheduled birds.

${c('dim', 'subcommands:')}

  ${c('cyan', 'list')}                         list all birds
  ${c('cyan', 'add')} <schedule> <prompt>      add a new bird
  ${c('cyan', 'edit')} <uid>                   edit a bird
  ${c('cyan', 'remove')} <uid>                 remove a bird
  ${c('cyan', 'enable')} <uid>                 enable a bird
  ${c('cyan', 'disable')} <uid>                disable a bird
  ${c('cyan', 'fly')} <uid>                    trigger a bird manually
  ${c('cyan', 'flights')} <uid>                show flight history for a bird

${c('dim', 'options:')}

  ${c('yellow', '--channel')} <id>       target slack channel
  ${c('yellow', '--agent')} <id>         target agent id
  ${c('yellow', '--schedule')} <expr>    cron schedule expression
  ${c('yellow', '--prompt')} <text>      prompt text
  ${c('yellow', '--active-hours')} <range>  restrict runs to a time window (e.g. "09:00-17:00")
  ${c('yellow', '--limit')} <n>          number of flights to show (default: 10)
  ${c('yellow', '--json')}              output as JSON (with list, flights)
  ${c('yellow', '--db')} <path>          database file path (env: BROWSERBIRD_DB)
  ${c('yellow', '-h, --help')}           show this help
`.trim();

function statusColor(status: string | null | undefined): string {
  if (status == null) return '-';
  switch (status) {
    case 'success':
    case 'completed':
      return c('green', status);
    case 'running':
      return c('blue', status);
    case 'failed':
      return c('red', status);
    default:
      return status;
  }
}

function parseActiveHours(raw: string): { start: string; end: string } | null {
  const match = raw.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!match) return null;
  return { start: match[1]!, end: match[2]! };
}

function resolveBird(uidPrefix: string): CronJobRow | undefined {
  const result = resolveByUid<CronJobRow>('cron_jobs', uidPrefix);
  if (!result) {
    logger.error(`bird ${uidPrefix} not found`);
    process.exitCode = 1;
    return undefined;
  }
  if ('ambiguous' in result) {
    logger.error(
      `ambiguous bird ID "${uidPrefix}" matches ${result.count} birds, use a longer prefix`,
    );
    process.exitCode = 1;
    return undefined;
  }
  return result.row;
}

export function handleBirds(argv: string[]): void {
  const subcommand = argv[0] ?? 'list';
  const rest = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      channel: { type: 'string' },
      agent: { type: 'string' },
      schedule: { type: 'string' },
      prompt: { type: 'string' },
      'active-hours': { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  openDatabase(resolveDbPathFromArgv(argv));

  try {
    switch (subcommand) {
      case 'list': {
        const result = listCronJobs(1, 100);
        if (values.json) {
          console.log(JSON.stringify(result.items, null, 2));
          break;
        }
        console.log(`birds (${result.totalItems} total):`);
        if (result.items.length === 0) {
          console.log('\n  no birds configured');
          return;
        }
        console.log('');
        const rows = result.items.map((job) => [
          c('dim', shortUid(job.uid)),
          job.enabled ? c('green', 'enabled') : c('yellow', 'disabled'),
          job.schedule,
          job.agent_id,
          job.target_channel_id ?? '-',
          statusColor(job.last_status),
          job.prompt.slice(0, 50),
        ]);
        printTable(['uid', 'status', 'schedule', 'agent', 'channel', 'last', 'prompt'], rows, [
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
        const schedule =
          (values.schedule as string | undefined) || positionals[0];
        const prompt =
          (values.prompt as string | undefined) ||
          positionals.slice(values.schedule ? 0 : 1).join(' ') ||
          undefined;
        if (!schedule || !prompt) {
          logger.error(
            'usage: browserbird birds add --schedule <expr> --prompt <text> [--name <name>] [--channel <id>] [--agent <id>]',
          );
          process.exitCode = 1;
          return;
        }
        const birdName =
          (values.name as string | undefined) || deriveBirdName(prompt);
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
          birdName,
          schedule,
          prompt,
          values.channel as string | undefined,
          values.agent as string | undefined,
          activeStart,
          activeEnd,
        );
        logger.success(`bird ${shortUid(job.uid)} created: "${birdName}"`);
        process.stderr.write(
          c('dim', `  hint: run 'browserbird birds fly ${shortUid(job.uid)}' to trigger it now`) +
            '\n',
        );
        break;
      }

      case 'edit': {
        const uidPrefix = positionals[0];
        if (!uidPrefix) {
          logger.error(
            'usage: browserbird birds edit <uid> [--name <name>] [--schedule <expr>] [--prompt <text>] [--channel <id>] [--agent <id>] [--active-hours <range>]',
          );
          process.exitCode = 1;
          return;
        }
        const bird = resolveBird(uidPrefix);
        if (!bird) return;
        const channel = values.channel as string | undefined;
        const agent = values.agent as string | undefined;
        const schedule = values.schedule as string | undefined;
        const prompt = values.prompt as string | undefined;
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
        const editName = values.name as string | undefined;
        if (!schedule && !prompt && !channel && !agent && !editName && editActiveStart === undefined) {
          logger.error(
            'provide at least one of: --name, --schedule, --prompt, --channel, --agent, --active-hours',
          );
          process.exitCode = 1;
          return;
        }
        const updated = updateCronJob(bird.uid, {
          schedule,
          prompt,
          name: editName,
          targetChannelId: channel !== undefined ? channel || null : undefined,
          agentId: agent,
          activeHoursStart: editActiveStart,
          activeHoursEnd: editActiveEnd,
        });
        if (updated) {
          logger.success(`bird ${shortUid(bird.uid)} updated`);
          process.stderr.write(
            c('dim', `  hint: run 'browserbird birds list' to see updated birds`) + '\n',
          );
        } else {
          logger.error(`bird ${shortUid(bird.uid)} not found`);
          process.exitCode = 1;
        }
        break;
      }

      case 'remove': {
        const uidPrefix = positionals[0];
        if (!uidPrefix) {
          logger.error('usage: browserbird birds remove <uid>');
          process.exitCode = 1;
          return;
        }
        const bird = resolveBird(uidPrefix);
        if (!bird) return;
        if (deleteCronJob(bird.uid)) {
          logger.success(`bird ${shortUid(bird.uid)} removed`);
        } else {
          logger.error(`bird ${shortUid(bird.uid)} not found`);
          process.exitCode = 1;
        }
        break;
      }

      case 'enable':
      case 'disable': {
        const uidPrefix = positionals[0];
        if (!uidPrefix) {
          logger.error(`usage: browserbird birds ${subcommand} <uid>`);
          process.exitCode = 1;
          return;
        }
        const bird = resolveBird(uidPrefix);
        if (!bird) return;
        const enabled = subcommand === 'enable';
        if (setCronJobEnabled(bird.uid, enabled)) {
          logger.success(`bird ${shortUid(bird.uid)} ${enabled ? 'enabled' : 'disabled'}`);
          if (enabled) {
            process.stderr.write(
              c(
                'dim',
                `  hint: run 'browserbird birds fly ${shortUid(bird.uid)}' to trigger it now`,
              ) + '\n',
            );
          }
        } else {
          logger.error(`bird ${shortUid(bird.uid)} not found`);
          process.exitCode = 1;
        }
        break;
      }

      case 'fly': {
        const uidPrefix = positionals[0];
        if (!uidPrefix) {
          logger.error('usage: browserbird birds fly <uid>');
          process.exitCode = 1;
          return;
        }
        const cronJob = resolveBird(uidPrefix);
        if (!cronJob) return;
        const enqueuedJob = enqueue(
          'cron_run',
          {
            cronJobUid: cronJob.uid,
            prompt: cronJob.prompt,
            channelId: cronJob.target_channel_id,
            agentId: cronJob.agent_id,
          },
          { cronJobUid: cronJob.uid },
        );
        logger.success(`enqueued job #${enqueuedJob.id} for bird ${shortUid(cronJob.uid)}`);
        process.stderr.write(
          c(
            'dim',
            `  hint: run 'browserbird birds flights ${shortUid(cronJob.uid)}' to check results`,
          ) + '\n',
        );
        break;
      }

      case 'flights': {
        const uidPrefix = positionals[0];
        if (!uidPrefix) {
          logger.error('usage: browserbird birds flights <uid>');
          process.exitCode = 1;
          return;
        }
        const bird = resolveBird(uidPrefix);
        if (!bird) return;
        const perPage = values.limit != null ? Number(values.limit) : 10;
        if (!Number.isFinite(perPage) || perPage < 1) {
          logger.error('--limit must be a positive number');
          process.exitCode = 1;
          return;
        }
        const result = listFlights(1, perPage, { birdUid: bird.uid });
        if (values.json) {
          console.log(JSON.stringify(result.items, null, 2));
          break;
        }
        console.log(`flight history for bird ${shortUid(bird.uid)} (${result.totalItems} total):`);
        if (result.items.length === 0) {
          console.log('\n  no flights recorded');
          return;
        }
        console.log('');
        const rows = result.items.map((flight) => {
          const durationMs = flight.finished_at
            ? new Date(flight.finished_at).getTime() - new Date(flight.started_at).getTime()
            : null;
          const duration = durationMs == null ? '-' : formatDuration(durationMs);
          return [
            c('dim', shortUid(flight.uid)),
            statusColor(flight.status),
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
        unknownSubcommand(subcommand, 'birds', [
          'list',
          'add',
          'edit',
          'remove',
          'enable',
          'disable',
          'fly',
          'flights',
        ]);
    }
  } finally {
    closeDatabase();
  }
}

/** @fileoverview Birds command: manage scheduled birds (cron jobs). */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { logger } from '../core/logger.ts';
import { shortUid } from '../core/uid.ts';
import { formatDuration, deriveBirdName, printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import type { CronJobRow, FlightRow, PaginatedResult } from '../db/index.ts';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

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
  ${c('cyan', 'fly')} <uid> [args]              trigger a bird ($ARGUMENTS substituted)
  ${c('cyan', 'flights')} <uid>                show flight history for a bird

${c('dim', 'options:')}

  ${c('yellow', '--channel')} <id>       target slack channel
  ${c('yellow', '--agent')} <id>         target agent id
  ${c('yellow', '--schedule')} <expr>    cron schedule expression
  ${c('yellow', '--prompt')} <text>      prompt text
  ${c('yellow', '--prompt-file')} <path> read prompt from a file (alternative to --prompt)
  ${c('yellow', '--active-hours')} <range>  restrict runs to a time window (e.g. "09:00-17:00")
  ${c('yellow', '--limit')} <n>          number of flights to show (default: 10)
  ${c('yellow', '--json')}              output as JSON (with list, flights)
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

function readPromptFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    logger.error(`cannot read --prompt-file ${path}: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
    return null;
  }
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

export async function handleBirds(argv: string[]): Promise<void> {
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
      'prompt-file': { type: 'string' },
      'active-hours': { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  switch (subcommand) {
    case 'list': {
      const result = await runDaemonCall<PaginatedResult<CronJobRow>>(() =>
        daemonRequest<PaginatedResult<CronJobRow>>({
          method: 'GET',
          path: '/api/birds?perPage=100',
        }),
      );
      if (!result) return;
      if (values.json) {
        console.log(JSON.stringify(result.items, null, 2));
        return;
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
      return;
    }

    case 'add': {
      const schedule = (values.schedule as string | undefined) || positionals[0];
      const promptFile = values['prompt-file'] as string | undefined;
      if (promptFile && values.prompt) {
        logger.error('use either --prompt or --prompt-file, not both');
        process.exitCode = 1;
        return;
      }
      let prompt: string | undefined;
      if (promptFile) {
        const content = readPromptFile(promptFile);
        if (content === null) return;
        prompt = content;
      } else {
        prompt =
          (values.prompt as string | undefined) ||
          positionals.slice(values.schedule ? 0 : 1).join(' ') ||
          undefined;
      }
      if (!schedule || !prompt) {
        logger.error(
          'usage: browserbird birds add --schedule <expr> (--prompt <text> | --prompt-file <path>) [--name <name>] [--channel <id>] [--agent <id>]',
        );
        process.exitCode = 1;
        return;
      }
      const birdName = (values.name as string | undefined) || deriveBirdName(prompt);
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
      const job = await runDaemonCall<CronJobRow>(() =>
        daemonRequest<CronJobRow>({
          method: 'POST',
          path: '/api/birds',
          body: {
            name: birdName,
            schedule,
            prompt,
            channel: values.channel as string | undefined,
            agent: values.agent as string | undefined,
            activeHoursStart: activeStart,
            activeHoursEnd: activeEnd,
          },
        }),
      );
      if (!job) return;
      logger.success(`bird ${shortUid(job.uid)} created: "${birdName}"`);
      process.stderr.write(
        c('dim', `  hint: run 'browserbird birds fly ${shortUid(job.uid)}' to trigger it now`) +
          '\n',
      );
      return;
    }

    case 'edit': {
      const uidPrefix = positionals[0];
      if (!uidPrefix) {
        logger.error(
          'usage: browserbird birds edit <uid> [--name <name>] [--schedule <expr>] [--prompt <text> | --prompt-file <path>] [--channel <id>] [--agent <id>] [--active-hours <range>]',
        );
        process.exitCode = 1;
        return;
      }
      const channel = values.channel as string | undefined;
      const agent = values.agent as string | undefined;
      const schedule = values.schedule as string | undefined;
      const editPromptFile = values['prompt-file'] as string | undefined;
      if (editPromptFile && values.prompt) {
        logger.error('use either --prompt or --prompt-file, not both');
        process.exitCode = 1;
        return;
      }
      let prompt: string | undefined;
      if (editPromptFile) {
        const content = readPromptFile(editPromptFile);
        if (content === null) return;
        prompt = content;
      } else {
        prompt = values.prompt as string | undefined;
      }
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
      if (
        !schedule &&
        !prompt &&
        !channel &&
        !agent &&
        !editName &&
        editActiveStart === undefined
      ) {
        logger.error(
          'provide at least one of: --name, --schedule, --prompt, --channel, --agent, --active-hours',
        );
        process.exitCode = 1;
        return;
      }
      const updated = await runDaemonCall<CronJobRow>(() =>
        daemonRequest<CronJobRow>({
          method: 'PATCH',
          path: `/api/birds/${uidPrefix}`,
          body: {
            schedule,
            prompt,
            name: editName,
            channel: channel !== undefined ? channel || null : undefined,
            agent,
            activeHoursStart: editActiveStart,
            activeHoursEnd: editActiveEnd,
          },
        }),
      );
      if (!updated) return;
      logger.success(`bird ${shortUid(updated.uid)} updated`);
      process.stderr.write(
        c('dim', `  hint: run 'browserbird birds list' to see updated birds`) + '\n',
      );
      return;
    }

    case 'remove': {
      const uidPrefix = positionals[0];
      if (!uidPrefix) {
        logger.error('usage: browserbird birds remove <uid>');
        process.exitCode = 1;
        return;
      }
      const removed = await runDaemonCall(() =>
        daemonRequest<{ success?: boolean }>({
          method: 'DELETE',
          path: `/api/birds/${uidPrefix}`,
        }),
      );
      if (removed === undefined) return;
      logger.success(`bird ${uidPrefix} removed`);
      return;
    }

    case 'enable':
    case 'disable': {
      const uidPrefix = positionals[0];
      if (!uidPrefix) {
        logger.error(`usage: browserbird birds ${subcommand} <uid>`);
        process.exitCode = 1;
        return;
      }
      const enabled = subcommand === 'enable';
      const result = await runDaemonCall(() =>
        daemonRequest<{ success?: boolean }>({
          method: 'PATCH',
          path: `/api/birds/${uidPrefix}/${enabled ? 'enable' : 'disable'}`,
        }),
      );
      if (result === undefined) return;
      logger.success(`bird ${uidPrefix} ${enabled ? 'enabled' : 'disabled'}`);
      if (enabled) {
        process.stderr.write(
          c('dim', `  hint: run 'browserbird birds fly ${uidPrefix}' to trigger it now`) + '\n',
        );
      }
      return;
    }

    case 'fly': {
      const uidPrefix = positionals[0];
      if (!uidPrefix) {
        logger.error('usage: browserbird birds fly <uid> [arguments]');
        process.exitCode = 1;
        return;
      }
      const flyArgs = positionals.slice(1).join(' ');
      const result = await runDaemonCall<{ success?: boolean; jobId?: number }>(() =>
        daemonRequest<{ success?: boolean; jobId?: number }>({
          method: 'POST',
          path: `/api/birds/${uidPrefix}/fly`,
          body: flyArgs ? { args: flyArgs } : {},
        }),
      );
      if (!result) return;
      const jobLabel = result.jobId !== undefined ? `job #${result.jobId}` : 'job';
      logger.success(`enqueued ${jobLabel} for bird ${uidPrefix}`);
      process.stderr.write(
        c('dim', `  hint: run 'browserbird birds flights ${uidPrefix}' to check results`) + '\n',
      );
      return;
    }

    case 'flights': {
      const uidPrefix = positionals[0];
      if (!uidPrefix) {
        logger.error('usage: browserbird birds flights <uid>');
        process.exitCode = 1;
        return;
      }
      const perPage = values.limit != null ? Number(values.limit) : 10;
      if (!Number.isFinite(perPage) || perPage < 1) {
        logger.error('--limit must be a positive number');
        process.exitCode = 1;
        return;
      }
      const result = await runDaemonCall<PaginatedResult<FlightRow>>(() =>
        daemonRequest<PaginatedResult<FlightRow>>({
          method: 'GET',
          path: `/api/birds/${uidPrefix}/flights?perPage=${perPage}`,
        }),
      );
      if (!result) return;
      if (values.json) {
        console.log(JSON.stringify(result.items, null, 2));
        return;
      }
      console.log(`flight history for bird ${uidPrefix} (${result.totalItems} total):`);
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
      return;
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
}

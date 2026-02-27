/** @fileoverview Slash command handler for `/bird` commands in Slack. */

import type { WebClient } from '@slack/web-api';
import type { Config } from '../core/types.ts';
import type { ChannelClient } from './types.ts';

import * as db from '../db/index.ts';
import { enqueue } from '../jobs.ts';
import { logger } from '../core/logger.ts';
import {
  birdListBlocks,
  birdFlyBlocks,
  birdLogsBlocks,
  birdCreateModal,
  statusBlocks,
} from './blocks.ts';

export interface SlashCommandBody {
  command: string;
  text: string;
  trigger_id: string;
  user_id: string;
  channel_id: string;
  team_id: string;
}

export interface StatusProvider {
  slackConnected: () => boolean;
  activeCount: () => number;
}

const startTime = Date.now();

function formatUptime(): string {
  const ms = Date.now() - startTime;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export async function handleSlashCommand(
  body: SlashCommandBody,
  webClient: WebClient,
  channelClient: ChannelClient,
  config: Config,
  status: StatusProvider,
): Promise<void> {
  const parts = body.text.trim().split(/\s+/);
  const subcommand = parts[0] ?? 'help';

  async function say(message: { text: string; blocks?: unknown[] }): Promise<void> {
    await webClient.chat.postMessage({
      channel: body.channel_id,
      text: message.text,
      ...(message.blocks ? { blocks: message.blocks } : {}),
    });
  }

  function findBird(nameOrUid: string): db.CronJobRow | undefined {
    const byUid = db.resolveByUid<db.CronJobRow>('cron_jobs', nameOrUid);
    if (byUid && 'row' in byUid) return byUid.row;
    const result = db.listCronJobs(1, 100, false);
    return result.items.find((b) => b.name === nameOrUid);
  }

  switch (subcommand) {
    case 'list': {
      const result = db.listCronJobs(1, 20, false);
      const birds = result.items.map((b) => ({
        uid: b.uid,
        name: b.name,
        schedule: b.schedule,
        enabled: b.enabled === 1,
        lastStatus: b.last_status,
        agentId: b.agent_id,
      }));
      const blocks = birdListBlocks(birds);
      await say({
        text: `${birds.length} bird${birds.length === 1 ? '' : 's'} configured`,
        blocks,
      });
      break;
    }

    case 'fly': {
      const birdName = parts.slice(1).join(' ');
      if (!birdName) {
        await say({ text: 'Usage: `/bird fly <name or id>`' });
        return;
      }

      const bird = findBird(birdName);
      if (!bird) {
        await say({ text: `Bird not found: \`${birdName}\`` });
        return;
      }

      enqueue(
        'cron_run',
        {
          cronJobUid: bird.uid,
          prompt: bird.prompt,
          channelId: bird.target_channel_id,
          agentId: bird.agent_id,
        },
        { maxAttempts: config.birds.maxAttempts, timeout: 600, cronJobUid: bird.uid },
      );

      const blocks = birdFlyBlocks(bird.name, body.user_id);
      await say({ text: `${bird.name} is taking flight...`, blocks });
      logger.info(`/bird fly: ${bird.name} triggered by ${body.user_id}`);
      break;
    }

    case 'enable':
    case 'disable': {
      const birdName = parts.slice(1).join(' ');
      if (!birdName) {
        await say({ text: `Usage: \`/bird ${subcommand} <name or id>\`` });
        return;
      }

      const bird = findBird(birdName);
      if (!bird) {
        await say({ text: `Bird not found: \`${birdName}\`` });
        return;
      }

      const enabling = subcommand === 'enable';
      const alreadyInState = (bird.enabled === 1) === enabling;
      if (alreadyInState) {
        await say({ text: `*${bird.name}* is already ${subcommand}d.` });
        return;
      }

      db.setCronJobEnabled(bird.uid, enabling);
      await say({ text: `*${bird.name}* ${subcommand}d.` });
      logger.info(`/bird ${subcommand}: ${bird.name} by ${body.user_id}`);
      break;
    }

    case 'logs': {
      const birdName = parts.slice(1).join(' ');
      if (!birdName) {
        await say({ text: 'Usage: `/bird logs <name or id>`' });
        return;
      }

      const bird = findBird(birdName);
      if (!bird) {
        await say({ text: `Bird not found: \`${birdName}\`` });
        return;
      }

      const flights = db.listFlights(1, 5, { birdUid: bird.uid });
      const mapped = flights.items.map((f) => {
        const durationMs =
          f.finished_at && f.started_at
            ? new Date(f.finished_at).getTime() - new Date(f.started_at).getTime()
            : undefined;
        return {
          uid: f.uid,
          status: f.status,
          startedAt: f.started_at,
          durationMs,
          error: f.error ?? undefined,
        };
      });

      const blocks = birdLogsBlocks(bird.name, mapped);
      const text = `${flights.totalItems} flight${flights.totalItems === 1 ? '' : 's'} for ${bird.name}`;
      await say({ text, blocks });
      break;
    }

    case 'create': {
      if (!channelClient.openModal) {
        await say({ text: 'Modals are not supported by this adapter.' });
        return;
      }

      const modal = birdCreateModal();
      await channelClient.openModal(body.trigger_id, modal);
      break;
    }

    case 'status': {
      const cronJobs = db.listCronJobs(1, 1, false);
      const blocks = statusBlocks({
        slackConnected: status.slackConnected(),
        activeCount: status.activeCount(),
        maxConcurrent: config.sessions.maxConcurrent,
        birdCount: cronJobs.totalItems,
        uptime: formatUptime(),
      });
      await say({ text: 'BrowserBird status', blocks });
      break;
    }

    default:
      await say({
        text: [
          '*Usage:* `/bird <command>`',
          '',
          '`/bird list` - Show all configured birds',
          '`/bird fly <name>` - Trigger a bird immediately',
          '`/bird logs <name>` - Show recent flights',
          '`/bird enable <name>` - Enable a bird',
          '`/bird disable <name>` - Disable a bird',
          '`/bird create` - Create a new bird (opens form)',
          '`/bird status` - Show daemon status',
        ].join('\n'),
      });
  }
}

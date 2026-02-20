/** @fileoverview Slack adapter — Bolt setup, SlackChannelClient, and event handlers. */

import type { Config, SlackConfig } from '../core/types.ts';
import type { ChannelClient, ChannelHandle } from './types.ts';

import { App, LogLevel } from '@slack/bolt';
import bolt from '@slack/bolt';

const { SocketModeReceiver } = bolt;
import { createCoalescer } from './coalesce.ts';
import { createHandler } from './handler.ts';
import { logger } from '../core/logger.ts';

class SlackChannelClient implements ChannelClient {
  private readonly client: InstanceType<typeof App>['client'];

  constructor(client: InstanceType<typeof App>['client']) {
    this.client = client;
  }

  async postMessage(channelId: string, threadTs: string, text: string): Promise<string> {
    const result = await this.client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text,
    });
    return result.ts ?? '';
  }

  async editMessage(channelId: string, messageId: string, text: string): Promise<void> {
    await this.client.chat.update({ channel: channelId, ts: messageId, text });
  }

  async postEphemeral(
    channelId: string,
    threadTs: string,
    userId: string,
    text: string,
  ): Promise<void> {
    await this.client.chat.postEphemeral({
      channel: channelId,
      thread_ts: threadTs,
      user: userId,
      text,
    });
  }

  async uploadFile(
    channelId: string,
    threadTs: string,
    content: Buffer,
    filename: string,
    title: string,
  ): Promise<void> {
    const upload = await this.client.files.getUploadURLExternal({
      filename,
      length: content.byteLength,
    });
    if (!upload.upload_url || !upload.file_id) return;
    await fetch(upload.upload_url, { method: 'POST', body: new Uint8Array(content) });
    await this.client.files.completeUploadExternal({
      files: [{ id: upload.file_id, title }],
      channel_id: channelId,
      thread_ts: threadTs,
    });
  }

  async addReaction(channelId: string, messageId: string, name: string): Promise<void> {
    try {
      await this.client.reactions.add({ channel: channelId, timestamp: messageId, name });
    } catch {
      /* reaction may already exist or message was deleted */
    }
  }

  async removeReaction(channelId: string, messageId: string, name: string): Promise<void> {
    try {
      await this.client.reactions.remove({ channel: channelId, timestamp: messageId, name });
    } catch {
      /* reaction may not exist */
    }
  }
}

const IGNORED_SUBTYPES = new Set([
  'bot_message',
  'message_changed',
  'message_deleted',
  'message_replied',
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'file_share',
  'pinned_item',
  'unpinned_item',
]);

const DEDUP_TTL_MS = 30_000;
const DEDUP_CLEANUP_MS = 60_000;

export function createSlackChannel(config: Config, signal: AbortSignal): ChannelHandle {
  const recentEvents = new Map<string, number>();

  const receiver = new SocketModeReceiver({
    appToken: config.slack.appToken,
    logLevel: LogLevel.WARN,
  });

  // Tune Socket Mode timeouts to prevent disconnects during long agent responses.
  // Defaults (5s client / 30s server) are too aggressive when the event loop is busy.
  const socketClient = receiver.client as unknown as Record<string, unknown>;
  socketClient['clientPingTimeoutMS'] = 15_000;
  socketClient['serverPingTimeoutMS'] = 60_000;

  const app = new App({
    token: config.slack.botToken,
    receiver,
    ignoreSelf: true,
  });

  const channelClient = new SlackChannelClient(app.client);
  const handler = createHandler(channelClient, config, signal);
  const coalescer = createCoalescer(config.slack.coalesce, (dispatch) => {
    handler.handle(dispatch);
  });

  const dedupTimer = setInterval(() => {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [key, ts] of recentEvents) {
      if (ts < cutoff) recentEvents.delete(key);
    }
  }, DEDUP_CLEANUP_MS);

  signal.addEventListener('abort', () => {
    clearInterval(dedupTimer);
  });

  app.message(async ({ message, body }) => {
    if (!('text' in message) || !message.text) return;
    if ('subtype' in message && message.subtype && IGNORED_SUBTYPES.has(message.subtype)) return;
    if ('bot_id' in message && message.bot_id) return;

    const eventId = (body as Record<string, unknown>)['event_id'] as string | undefined;
    if (eventId) {
      if (recentEvents.has(eventId)) return;
      recentEvents.set(eventId, Date.now());
    }

    const channelId = message.channel;
    if (!isChannelAllowed(channelId, config.slack.permissions)) return;

    const channelType = (message as unknown as Record<string, unknown>)['channel_type'] as
      | string
      | undefined;
    const isDm = channelType === 'im';

    if (!isDm && isQuietHours(config.slack.quietHours)) return;

    const threadTs = ('thread_ts' in message ? message.thread_ts : undefined) ?? message.ts;
    const userId = 'user' in message ? (message.user as string) : 'unknown';
    const text = stripMention(message.text);

    if (!text.trim()) return;

    if (isDm && config.slack.coalesce.bypassDms) {
      handler.handle({
        channelId,
        threadTs,
        messages: [{ userId, text, timestamp: message.ts }],
      });
    } else {
      coalescer.push(channelId, threadTs, userId, text, message.ts);
    }
  });

  app.event('app_mention', async ({ event, body }) => {
    const eventId = (body as Record<string, unknown>)['event_id'] as string | undefined;
    if (eventId) {
      if (recentEvents.has(eventId)) return;
      recentEvents.set(eventId, Date.now());
    }

    const channelId = event.channel;
    if (!isChannelAllowed(channelId, config.slack.permissions)) return;
    if (isQuietHours(config.slack.quietHours)) return;

    const messageTs = event.ts;
    if (!messageTs) return;

    const threadTs = event.thread_ts ?? messageTs;
    const userId = event.user ?? 'unknown';
    const text = stripMention(event.text ?? '');

    if (!text.trim()) return;

    coalescer.push(channelId, threadTs, userId, text, messageTs);
  });

  let connected = false;

  const client = receiver.client as unknown as {
    on(event: string, cb: (...args: unknown[]) => void): void;
    numOfConsecutiveReconnectionFailures: number;
  };

  client.on('connected', () => {
    connected = true;
    logger.success('slack connected');
  });

  client.on('reconnecting', () => {
    connected = false;
    logger.info('slack reconnecting...');
  });

  client.on('disconnected', () => {
    connected = false;
    logger.warn('slack disconnected');
  });

  // After prolonged disconnection the back-off delay grows large
  // (clientPingTimeoutMS * numFailures). Cap it so reconnect stays responsive.
  const MAX_CONSECUTIVE_FAILURES = 5;
  client.on('close', () => {
    if (client.numOfConsecutiveReconnectionFailures > MAX_CONSECUTIVE_FAILURES) {
      client.numOfConsecutiveReconnectionFailures = 1;
      logger.info('reset reconnection back-off counter');
    }
  });

  async function start(): Promise<void> {
    await app.start();
    connected = true;
  }

  async function stop(): Promise<void> {
    connected = false;
    coalescer.destroy();
    handler.killAll();
    clearInterval(dedupTimer);
    await app.stop();
    logger.info('slack stopped');
  }

  function isConnected(): boolean {
    return connected;
  }

  async function postMessage(channel: string, text: string): Promise<void> {
    await app.client.chat.postMessage({ channel, text });
  }

  return { start, stop, isConnected, postMessage };
}

function isChannelAllowed(channelId: string, permissions: SlackConfig['permissions']): boolean {
  if (permissions.denyChannels.includes(channelId)) return false;
  if (permissions.allowChannels.includes('*')) return true;
  return permissions.allowChannels.includes(channelId);
}

function isQuietHours(quietHours: SlackConfig['quietHours']): boolean {
  if (!quietHours.enabled) return false;

  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: quietHours.timezone,
  });

  function parseHHMM(s: string): number {
    const parts = s.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h * 60 + m;
  }

  const currentMinutes = parseHHMM(formatter.format(new Date()));
  const startMinutes = parseHHMM(quietHours.start);
  const endMinutes = parseHHMM(quietHours.end);

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function stripMention(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/i, '').trim();
}

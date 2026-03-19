/** @fileoverview Slack adapter: SocketModeClient + WebClient, streaming, and assistant APIs. */

import type { Config, SlackConfig } from '../core/types.ts';
import type {
  ChannelClient,
  ChannelHandle,
  MessageOptions,
  StreamHandle,
  StreamStartOptions,
} from './types.ts';
import type { ModalView } from './blocks.ts';
import type { SlashCommandBody } from './commands.ts';

import type { Handler } from './handler.ts';

import { SocketModeClient } from '@slack/socket-mode';
import { WebClient, LogLevel } from '@slack/web-api';
import { createCoalescer } from './coalesce.ts';
import { createHandler } from './handler.ts';
import { handleSlashCommand } from './commands.ts';
import { logger } from '../core/logger.ts';
import { isWithinTimeRange } from '../core/utils.ts';
import { insertFeedback } from '../db/feedback.ts';
import {
  createCronJob,
  setCronJobEnabled,
  getSession,
  getLastInboundMessage,
} from '../db/index.ts';

class SlackChannelClient implements ChannelClient {
  private readonly web: WebClient;

  constructor(web: WebClient) {
    this.web = web;
  }

  async postMessage(
    channelId: string,
    threadTs: string,
    text: string,
    opts?: MessageOptions,
  ): Promise<string> {
    const result = await this.web.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text,
      ...(opts?.blocks ? { blocks: opts.blocks } : {}),
    });
    return result.ts ?? '';
  }

  async postEphemeral(
    channelId: string,
    threadTs: string,
    userId: string,
    text: string,
    opts?: MessageOptions,
  ): Promise<void> {
    await this.web.chat.postEphemeral({
      channel: channelId,
      thread_ts: threadTs,
      user: userId,
      text,
      ...(opts?.blocks ? { blocks: opts.blocks } : {}),
    });
  }

  async openModal(triggerId: string, view: ModalView): Promise<void> {
    await this.web.views.open({ trigger_id: triggerId, view });
  }

  async uploadFile(
    channelId: string,
    threadTs: string,
    content: Buffer,
    filename: string,
    title: string,
  ): Promise<void> {
    const upload = await this.web.files.getUploadURLExternal({
      filename,
      length: content.byteLength,
    });
    if (!upload.upload_url || !upload.file_id) return;
    await fetch(upload.upload_url, { method: 'POST', body: new Uint8Array(content) });
    await this.web.files.completeUploadExternal({
      files: [{ id: upload.file_id, title }],
      channel_id: channelId,
      thread_ts: threadTs,
    });
  }

  startStream(opts: StreamStartOptions): StreamHandle {
    return this.web.chatStream({
      channel: opts.channelId,
      thread_ts: opts.threadTs,
      recipient_team_id: opts.teamId,
      recipient_user_id: opts.userId,
      task_display_mode: 'plan',
      buffer_size: 128,
    });
  }

  async setStatus(channelId: string, threadTs: string, status: string): Promise<void> {
    await this.web.assistant.threads.setStatus({
      channel_id: channelId,
      thread_ts: threadTs,
      status,
    });
  }

  async setTitle(channelId: string, threadTs: string, title: string): Promise<void> {
    await this.web.assistant.threads.setTitle({
      channel_id: channelId,
      thread_ts: threadTs,
      title,
    });
  }

  async setSuggestedPrompts(
    channelId: string,
    threadTs: string,
    prompts: Array<{ title: string; message: string }>,
  ): Promise<void> {
    await this.web.assistant.threads.setSuggestedPrompts({
      channel_id: channelId,
      thread_ts: threadTs,
      prompts,
    });
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

function logDispatchError(err: unknown): void {
  logger.error(`dispatch error: ${err instanceof Error ? err.message : String(err)}`);
}

interface SocketModeEvent {
  ack: (response?: unknown) => Promise<void>;
  envelope_id: string;
  body: Record<string, unknown>;
  event?: Record<string, unknown>;
  retry_num?: number;
  retry_reason?: string;
}

export function createSlackChannel(getConfig: () => Config, signal: AbortSignal): ChannelHandle {
  const recentEvents = new Map<string, number>();
  let botUserId = '';
  let teamId = '';

  const initConfig = getConfig();
  const socketClient = new SocketModeClient({
    appToken: initConfig.slack.appToken,
    logLevel: LogLevel.WARN,
    clientPingTimeout: 15_000,
    serverPingTimeout: 60_000,
  });

  const webClient = new WebClient(initConfig.slack.botToken);
  const channelClient = new SlackChannelClient(webClient);
  const handler = createHandler(
    channelClient,
    getConfig,
    signal,
    () => teamId,
    () => channelNameToId,
  );
  const coalescer = createCoalescer(initConfig.slack.coalesce, (dispatch) => {
    handler.handle(dispatch).catch(logDispatchError);
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

  function isDuplicate(body: Record<string, unknown>): boolean {
    const eventId = body['event_id'] as string | undefined;
    if (!eventId) return false;
    if (recentEvents.has(eventId)) return true;
    recentEvents.set(eventId, Date.now());
    return false;
  }

  socketClient.on('message', async ({ ack, body, event }: SocketModeEvent) => {
    await ack();
    if (!event) return;
    if (event['user'] === botUserId) return;

    const text = event['text'] as string | undefined;
    if (!text) return;

    const subtype = event['subtype'] as string | undefined;
    if (subtype && IGNORED_SUBTYPES.has(subtype)) return;
    if (event['bot_id']) return;
    if (isDuplicate(body)) return;

    const config = getConfig();
    const channelType = event['channel_type'] as string | undefined;
    const isDm = channelType === 'im';

    if (!isDm && config.slack.requireMention) return;

    const channelId = event['channel'] as string;
    if (!isChannelAllowed(channelId, config.slack.channels, channelNameToId)) return;
    if (!isDm && isQuietHours(config.slack.quietHours)) return;

    const threadTs = (event['thread_ts'] as string | undefined) ?? (event['ts'] as string);
    const userId = (event['user'] as string) ?? 'unknown';
    const messageTs = event['ts'] as string;
    const cleanText = stripMention(text);

    if (!cleanText.trim()) return;

    if (cleanText.trim().toLowerCase() === 'stop') {
      const key = `${channelId}:${threadTs}`;
      const killed = handler.killSession(key);
      if (killed) {
        webClient.reactions
          .add({ channel: channelId, timestamp: messageTs, name: 'octagonal_sign' })
          .catch(() => {});
      }
      return;
    }

    if (isDm && config.slack.coalesce.bypassDms) {
      handler
        .handle({
          channelId,
          threadTs,
          messages: [{ userId, text: cleanText, timestamp: messageTs }],
        })
        .catch(logDispatchError);
    } else {
      coalescer.push(channelId, threadTs, userId, cleanText, messageTs);
    }
  });

  if (initConfig.slack.requireMention) {
    socketClient.on('app_mention', async ({ ack, body, event }: SocketModeEvent) => {
      await ack();
      if (!event) return;
      if (isDuplicate(body)) return;

      const config = getConfig();
      const channelId = event['channel'] as string;
      if (!isChannelAllowed(channelId, config.slack.channels, channelNameToId)) return;
      if (isQuietHours(config.slack.quietHours)) return;

      const messageTs = event['ts'] as string | undefined;
      if (!messageTs) return;

      const threadTs = (event['thread_ts'] as string | undefined) ?? messageTs;
      const userId = (event['user'] as string) ?? 'unknown';
      const text = stripMention((event['text'] as string) ?? '');

      if (!text.trim()) return;

      if (text.trim().toLowerCase() === 'stop') {
        const key = `${channelId}:${threadTs}`;
        const killed = handler.killSession(key);
        if (killed) {
          webClient.reactions
            .add({ channel: channelId, timestamp: messageTs!, name: 'octagonal_sign' })
            .catch(() => {});
        }
        return;
      }

      coalescer.push(channelId, threadTs, userId, text, messageTs);
    });
  }

  socketClient.on('assistant_thread_started', async ({ ack, event }: SocketModeEvent) => {
    await ack();
    if (!event) return;
    const threadInfo = event['assistant_thread'] as Record<string, unknown> | undefined;
    if (!threadInfo) return;

    const channelId = threadInfo['channel_id'] as string | undefined;
    const threadTs = threadInfo['thread_ts'] as string | undefined;
    if (!channelId || !threadTs) return;

    channelClient
      .setSuggestedPrompts(channelId, threadTs, [
        { title: 'Browse a website', message: 'Browse https://example.com and summarize it' },
        { title: 'Run a command', message: 'List files in the current directory' },
        { title: 'Help me code', message: 'Help me write a function that...' },
      ])
      .catch(() => {});
  });

  socketClient.on('assistant_thread_context_changed', async ({ ack }: SocketModeEvent) => {
    await ack();
  });

  let connected = false;
  const statusProvider = {
    slackConnected: () => connected,
    activeCount: () => handler.activeCount(),
  };

  socketClient.on('slash_commands', async ({ ack, body }: SocketModeEvent) => {
    await ack();
    const commandBody = body as unknown as SlashCommandBody;
    if (commandBody.command !== '/bird') return;

    try {
      await handleSlashCommand(commandBody, webClient, channelClient, getConfig(), statusProvider);
    } catch (err) {
      logger.error(`/bird command error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  socketClient.on('interactive', async ({ ack, body }: SocketModeEvent) => {
    await ack();
    const interactionType = body['type'] as string | undefined;

    if (interactionType === 'view_submission') {
      const view = body['view'] as Record<string, unknown> | undefined;
      if (view?.['callback_id'] === 'bird_create') {
        await handleBirdCreateSubmission(view, webClient);
      }
    }

    if (interactionType === 'block_actions') {
      const actionsArr = body['actions'] as Array<Record<string, unknown>> | undefined;
      const channel = (body['channel'] as Record<string, unknown> | undefined)?.['id'] as
        | string
        | undefined;
      const user = (body['user'] as Record<string, unknown> | undefined)?.['id'] as
        | string
        | undefined;
      if (!actionsArr || !channel) return;

      for (const action of actionsArr) {
        const actionId = action['action_id'] as string | undefined;

        if (actionId === 'session_error_overflow' || actionId === 'session_retry') {
          const raw =
            actionId === 'session_error_overflow'
              ? ((action['selected_option'] as Record<string, unknown> | undefined)?.['value'] as
                  | string
                  | undefined)
              : (action['value'] as string | undefined);
          if (!raw?.startsWith('retry:')) continue;
          const sessionUid = raw.slice('retry:'.length);
          if (!sessionUid) continue;
          await handleSessionRetry(sessionUid, user ?? 'unknown', handler);
        }

        if (actionId === 'response_feedback') {
          const value = action['value'] as string | undefined;
          if (value === 'good' || value === 'bad') {
            const message = body['message'] as Record<string, unknown> | undefined;
            const threadTs = message?.['thread_ts'] as string | undefined;
            const messageTs = message?.['ts'] as string | undefined;
            insertFeedback(channel, threadTs, messageTs, user ?? 'unknown', value);
            logger.info(`feedback: ${value} from ${user} in ${channel}`);
          }
        }
      }
    }
  });

  const MAX_CONSECUTIVE_FAILURES = 5;

  socketClient.on('connected', () => {
    connected = true;
    logger.success('slack connected');
  });

  socketClient.on('reconnecting', () => {
    connected = false;
    logger.info('slack reconnecting...');
  });

  socketClient.on('disconnected', () => {
    connected = false;
    logger.warn('slack disconnected');
  });

  socketClient.on('close' as string, () => {
    const failures = (socketClient as unknown as Record<string, unknown>)[
      'numOfConsecutiveReconnectionFailures'
    ] as number | undefined;
    if (failures != null && failures > MAX_CONSECUTIVE_FAILURES) {
      (socketClient as unknown as Record<string, number>)['numOfConsecutiveReconnectionFailures'] =
        1;
      logger.info('reset reconnection back-off counter');
    }
  });

  /** Rebuilt on connect and config reload via resolveChannelNames(). */
  const channelNameToId = new Map<string, string>();

  async function resolveChannelNames(): Promise<void> {
    const target = getConfig();
    const namesToResolve = new Set<string>();

    function collectNames(channels: string[]): void {
      for (const ch of channels) {
        if (ch !== '*' && !ch.startsWith('C') && !ch.startsWith('D') && !ch.startsWith('G')) {
          namesToResolve.add(ch);
        }
      }
    }

    collectNames(target.slack.channels);
    for (const agent of target.agents) {
      collectNames(agent.channels);
    }
    if (namesToResolve.size === 0) return;

    channelNameToId.clear();
    try {
      let cursor: string | undefined;
      do {
        const result = await webClient.conversations.list({
          types: 'public_channel,private_channel',
          limit: 200,
          exclude_archived: true,
          cursor,
        });
        for (const ch of result.channels ?? []) {
          if (ch.name && ch.id && namesToResolve.has(ch.name)) {
            channelNameToId.set(ch.name, ch.id);
            logger.info(`resolved channel "${ch.name}" -> ${ch.id}`);
          }
        }
        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);
    } catch (err) {
      logger.warn(
        `failed to resolve channel names: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    for (const name of namesToResolve) {
      if (!channelNameToId.has(name)) {
        logger.warn(`channel "${name}" not found in workspace`);
      }
    }
  }

  async function start(): Promise<void> {
    const authResult = await webClient.auth.test();
    botUserId = (authResult.user_id as string) ?? '';
    teamId = (authResult.team_id as string) ?? '';
    logger.info(`authenticated as ${authResult.user} (team: ${teamId})`);

    await resolveChannelNames();

    await socketClient.start();
    connected = true;
  }

  async function stop(): Promise<void> {
    connected = false;
    coalescer.destroy();
    handler.killAll();
    clearInterval(dedupTimer);
    await socketClient.disconnect();
    logger.info('slack stopped');
  }

  function isConnected(): boolean {
    return connected;
  }

  async function postMessage(channel: string, text: string, opts?: MessageOptions): Promise<void> {
    await webClient.chat.postMessage({
      channel,
      text,
      ...(opts?.blocks ? { blocks: opts.blocks } : {}),
    });
  }

  return {
    start,
    stop,
    isConnected,
    activeCount: () => handler.activeCount(),
    postMessage,
    resolveChannelNames,
  };
}

async function handleBirdCreateSubmission(
  view: Record<string, unknown>,
  webClient: WebClient,
): Promise<void> {
  try {
    const values = view['state'] as Record<string, unknown> | undefined;
    const stateValues = (values?.['values'] ?? {}) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;

    const name = (stateValues['bird_name']?.['name_input']?.['value'] as string | undefined) ?? '';
    const schedule = (
      stateValues['bird_schedule']?.['schedule_select']?.['selected_option'] as
        | Record<string, unknown>
        | undefined
    )?.['value'] as string | undefined;
    const prompt =
      (stateValues['bird_prompt']?.['prompt_input']?.['value'] as string | undefined) ?? '';
    const channelId =
      (stateValues['bird_channel']?.['channel_select']?.['selected_conversation'] as
        | string
        | undefined) ?? '';
    const enabledValue = (
      stateValues['bird_enabled']?.['enabled_radio']?.['selected_option'] as
        | Record<string, unknown>
        | undefined
    )?.['value'] as string | undefined;

    if (!name || !schedule || !prompt) {
      logger.warn('bird_create submission missing required fields');
      return;
    }

    const bird = createCronJob(name, schedule, prompt, channelId || undefined, 'default');
    if (enabledValue !== 'enabled') {
      setCronJobEnabled(bird.uid, false);
    }

    await webClient.chat.postMessage({
      channel: channelId || 'general',
      text: `Bird *${name}* created. Schedule: \`${schedule}\``,
    });

    logger.info(`bird created via modal: ${name}`);
  } catch (err) {
    logger.error(
      `bird_create submission error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function handleSessionRetry(
  sessionUid: string,
  userId: string,
  handler: Handler,
): Promise<void> {
  try {
    const session = getSession(sessionUid);
    if (!session) {
      logger.warn(`retry: session ${sessionUid} not found`);
      return;
    }

    const lastMsg = getLastInboundMessage(session.channel_id, session.thread_id);
    if (!lastMsg) {
      logger.warn(`retry: no inbound message for session ${sessionUid}`);
      return;
    }

    handler
      .handle({
        channelId: session.channel_id,
        threadTs: session.thread_id ?? lastMsg.timestamp,
        messages: [{ userId, text: lastMsg.content, timestamp: lastMsg.timestamp }],
      })
      .catch(logDispatchError);

    logger.info(`retry: session ${sessionUid} re-dispatched by ${userId}`);
  } catch (err) {
    logger.error(`retry error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isChannelAllowed(
  channelId: string,
  channels: string[],
  nameToId: Map<string, string>,
): boolean {
  if (channels.includes('*')) return true;
  for (const ch of channels) {
    if (ch === channelId) return true;
    const resolved = nameToId.get(ch);
    if (resolved === channelId) return true;
  }
  return false;
}

function isQuietHours(quietHours: SlackConfig['quietHours']): boolean {
  if (!quietHours.enabled) return false;
  return isWithinTimeRange(quietHours.start, quietHours.end, new Date(), quietHours.timezone);
}

function stripMention(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/i, '').trim();
}

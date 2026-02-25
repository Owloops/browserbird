/** @fileoverview Core orchestration — session resolution, spawn, stream-to-channel. */

import type { Config } from '../core/types.ts';
import type { CoalesceDispatch } from './coalesce.ts';
import type { StreamEvent, StreamEventCompletion, ToolImage } from '../provider/stream.ts';
import type { ChannelClient } from './types.ts';

import { resolveSession } from '../provider/session.ts';
import { spawnProvider } from '../provider/spawn.ts';
import * as db from '../db/index.ts';
import { logger } from '../core/logger.ts';
import { recordError } from '../core/metrics.ts';
import { broadcastSSE } from '../server/index.ts';
import { sessionErrorBlocks, busyBlocks, noAgentBlocks, completionFooterBlocks } from './blocks.ts';

interface SessionLock {
  processing: boolean;
  queue: CoalesceDispatch[];
  killCurrent: (() => void) | null;
}

export interface Handler {
  handle(dispatch: CoalesceDispatch): Promise<void>;
  activeCount(): number;
  killAll(): void;
}

export function createHandler(
  client: ChannelClient,
  config: Config,
  signal: AbortSignal,
  getTeamId: () => string,
): Handler {
  const locks = new Map<string, SessionLock>();
  let activeSpawns = 0;

  function getLock(key: string): SessionLock {
    let lock = locks.get(key);
    if (!lock) {
      lock = { processing: false, queue: [], killCurrent: null };
      locks.set(key, lock);
    }
    return lock;
  }

  function formatPrompt(messages: CoalesceDispatch['messages']): string {
    if (messages.length === 1) {
      return messages[0]!.text;
    }
    return messages
      .map((m) => {
        const time = new Date(Number(m.timestamp) * 1000).toISOString().slice(11, 19);
        return `[${time}] @${m.userId}: ${m.text}`;
      })
      .join('\n');
  }

  async function streamToChannel(
    events: AsyncIterable<StreamEvent>,
    channelId: string,
    threadTs: string,
    sessionId: number,
    teamId: string,
    userId: string,
    meta: { birdName?: string },
  ): Promise<void> {
    const streamer = client.startStream({ channelId, threadTs, teamId, userId });
    let fullText = '';
    let completion: StreamEventCompletion | undefined;
    let hasError = false;

    for await (const event of events) {
      if (signal.aborted) break;
      logger.debug(`stream event: ${event.type}`);

      switch (event.type) {
        case 'init':
          db.updateSessionProviderId(sessionId, event.sessionId);
          break;

        case 'text_delta':
          fullText += event.delta;
          await streamer.append({ markdown_text: event.delta });
          break;

        case 'tool_images':
          await uploadImages(event.images, channelId, threadTs);
          break;

        case 'completion':
          completion = event;
          logger.info(
            `completion [${event.subtype}]: ${event.tokensIn}in/${event.tokensOut}out, $${event.costUsd.toFixed(4)}, ${event.numTurns} turns`,
          );
          db.logMessage(
            channelId,
            threadTs,
            'bot',
            'out',
            fullText,
            event.tokensIn,
            event.tokensOut,
          );
          break;

        case 'rate_limit':
          logger.debug(`rate limit window resets ${new Date(event.resetsAt * 1000).toISOString()}`);
          break;

        case 'error':
          hasError = true;
          recordError('spawn');
          db.insertLog('error', 'spawn', event.error, channelId);
          await streamer.append({ markdown_text: `\n\n:x: ${event.error}` });
          break;
      }
    }

    const footerBlocks = completion
      ? completionFooterBlocks(completion, hasError, meta.birdName, userId)
      : undefined;

    await streamer.stop(footerBlocks ? { blocks: footerBlocks } : {});
  }

  async function uploadImages(
    images: ToolImage[],
    channelId: string,
    threadTs: string,
  ): Promise<void> {
    for (let i = 0; i < images.length; i++) {
      const img = images[i]!;
      const content = Buffer.from(img.data, 'base64');
      const ext = img.mediaType === 'image/jpeg' ? 'jpg' : 'png';
      const filename = `screenshot-${i + 1}.${ext}`;
      try {
        await client.uploadFile(channelId, threadTs, content, filename, `Screenshot ${i + 1}`);
      } catch (err) {
        logger.warn(`image upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async function handle(dispatch: CoalesceDispatch): Promise<void> {
    const { channelId, threadTs, messages } = dispatch;
    const key = `${channelId}:${threadTs}`;
    const lock = getLock(key);

    if (lock.processing) {
      lock.queue.push(dispatch);
      try {
        await client.postEphemeral(
          channelId,
          threadTs,
          messages[messages.length - 1]!.userId,
          "Got it, I'll get to this after my current response.",
        );
      } catch {
        /* postEphemeral may fail if user left channel */
      }
      return;
    }

    if (activeSpawns >= config.sessions.maxConcurrent) {
      const blocks = busyBlocks(activeSpawns, config.sessions.maxConcurrent);
      await client.postMessage(
        channelId,
        threadTs,
        'Too many active sessions. Try again shortly.',
        { blocks },
      );
      logger.warn('max concurrent sessions reached');
      return;
    }

    lock.processing = true;
    activeSpawns++;

    let sessionId: number | undefined;
    try {
      const resolved = resolveSession(channelId, threadTs, config);
      if (!resolved) {
        const blocks = noAgentBlocks(channelId);
        await client.postMessage(channelId, threadTs, 'No agent configured for this channel.', {
          blocks,
        });
        return;
      }

      const { session, agent, isNew } = resolved;
      sessionId = session.id;

      for (const msg of messages) {
        db.logMessage(channelId, threadTs, msg.userId, 'in', msg.text);
      }
      db.touchSession(session.id, messages.length + 1);
      broadcastSSE('invalidate', { resource: 'sessions' });

      const prompt = formatPrompt(messages);
      const lastMessage = messages[messages.length - 1]!;
      const userId = lastMessage.userId;

      const existingSessionId = isNew ? undefined : session.provider_session_id || undefined;
      const { events, kill } = spawnProvider(
        agent.provider,
        {
          message: prompt,
          sessionId: existingSessionId,
          agent,
          mcpConfigPath: config.browser.mcpConfigPath,
        },
        signal,
      );

      lock.killCurrent = kill;

      client.setStatus?.(channelId, threadTs, 'is thinking...').catch(() => {});

      if (isNew) {
        const title = prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;
        client.setTitle?.(channelId, threadTs, title).catch(() => {});
      }

      await streamToChannel(events, channelId, threadTs, session.id, getTeamId(), userId, {
        birdName: agent.name,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`handler error: ${errMsg}`);
      recordError('handler');
      db.insertLog('error', 'handler', errMsg, channelId);
      try {
        const blocks = sessionErrorBlocks(errMsg, { sessionId });
        await client.postMessage(channelId, threadTs, `Something went wrong: ${errMsg}`, {
          blocks,
        });
      } catch {
        /* channel may no longer be accessible */
      }
    } finally {
      activeSpawns--;
      lock.processing = false;
      lock.killCurrent = null;

      const next = lock.queue.shift();
      if (next) {
        handle(next);
      } else if (lock.queue.length === 0) {
        locks.delete(key);
      }
    }
  }

  function activeCount(): number {
    return activeSpawns;
  }

  function killAll(): void {
    for (const lock of locks.values()) {
      lock.killCurrent?.();
      lock.queue.length = 0;
    }
    locks.clear();
  }

  return { handle, activeCount, killAll };
}

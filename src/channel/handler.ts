/** @fileoverview Core orchestration — session resolution, spawn, stream-to-channel. */

import type { Config } from '../core/types.ts';
import type { CoalesceDispatch } from './coalesce.ts';
import type { StreamEvent, ToolImage } from '../provider/stream.ts';
import type { ChannelClient } from './types.ts';

import { resolveSession } from '../provider/session.ts';
import { spawnProvider } from '../provider/spawn.ts';
import * as db from '../db/index.ts';
import { logger } from '../core/logger.ts';
import { recordError } from '../core/metrics.ts';
import { broadcastSSE } from '../server/index.ts';

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

const EDIT_THROTTLE_MS = 1200;
const LONG_RESPONSE_BYTES = 3900;
const SNIPPET_TRIM_BYTES = 3800;

export function createHandler(client: ChannelClient, config: Config, signal: AbortSignal): Handler {
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
  ): Promise<void> {
    let fullText = '';
    let messageId: string | undefined;
    let lastEditTime = 0;
    let pendingEdit = false;

    async function postOrEdit(): Promise<void> {
      if (!messageId) {
        messageId = await client.postMessage(channelId, threadTs, fullText);
      } else {
        const now = Date.now();
        if (now - lastEditTime >= EDIT_THROTTLE_MS) {
          await client.editMessage(channelId, messageId, fullText);
          lastEditTime = now;
          pendingEdit = false;
        } else {
          pendingEdit = true;
        }
      }
    }

    let eventCount = 0;

    for await (const event of events) {
      if (signal.aborted) break;
      eventCount++;
      logger.debug(`stream event: ${event.type}`);

      switch (event.type) {
        case 'init':
          db.updateSessionProviderId(sessionId, event.sessionId);
          logger.debug(`session initialized: provider=${event.sessionId} model=${event.model}`);
          break;

        case 'text_delta':
          fullText += event.delta;
          await postOrEdit();
          break;

        case 'tool_use':
          fullText += `\n_Using ${event.name}..._\n`;
          await postOrEdit();
          break;

        case 'tool_images':
          await uploadImages(event.images, channelId, threadTs);
          break;

        case 'completion':
          logger.info(
            `completion: ${event.tokensIn}in/${event.tokensOut}out, $${event.costUsd.toFixed(4)}, ${event.numTurns} turns`,
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

        case 'error':
          recordError('spawn');
          db.insertLog('error', 'spawn', event.error, channelId);
          if (messageId) {
            fullText += `\n${event.error}`;
          } else {
            fullText = event.error;
          }
          break;
      }
    }

    logger.debug(`stream ended: ${eventCount} events, ${fullText.length} chars`);

    if (!fullText) return;

    if (Buffer.byteLength(fullText, 'utf8') > LONG_RESPONSE_BYTES) {
      await handleLongResponse(fullText, channelId, threadTs, messageId);
    } else if (messageId && pendingEdit) {
      await client.editMessage(channelId, messageId, fullText);
    } else if (!messageId) {
      await client.postMessage(channelId, threadTs, fullText);
    }
  }

  async function handleLongResponse(
    fullText: string,
    channelId: string,
    threadTs: string,
    messageId: string | undefined,
  ): Promise<void> {
    if (config.sessions.longResponseMode === 'thread') {
      await postAsThreadChunks(fullText, channelId, threadTs, messageId);
    } else {
      await postAsSnippet(fullText, channelId, threadTs, messageId);
    }
  }

  async function postAsThreadChunks(
    fullText: string,
    channelId: string,
    threadTs: string,
    messageId: string | undefined,
  ): Promise<void> {
    const chunks = splitByBytes(fullText, LONG_RESPONSE_BYTES);
    const firstChunk = chunks[0]!;

    if (messageId) {
      const text =
        chunks.length > 1 ? firstChunk + '\n\n_(continued in next message...)_' : firstChunk;
      await client.editMessage(channelId, messageId, text);
    } else {
      const text =
        chunks.length > 1 ? firstChunk + '\n\n_(continued in next message...)_' : firstChunk;
      await client.postMessage(channelId, threadTs, text);
    }

    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const text = i < chunks.length - 1 ? chunk + '\n\n_(continued in next message...)_' : chunk;
      await client.postMessage(channelId, threadTs, text);
    }
  }

  async function postAsSnippet(
    fullText: string,
    channelId: string,
    threadTs: string,
    messageId: string | undefined,
  ): Promise<void> {
    const trimmed = trimToBytes(fullText, SNIPPET_TRIM_BYTES);
    const preview = trimmed + '\n\n_Full response uploaded as file._';

    if (messageId) {
      await client.editMessage(channelId, messageId, preview);
    } else {
      await client.postMessage(channelId, threadTs, preview);
    }

    try {
      const content = Buffer.from(fullText, 'utf8');
      await client.uploadFile(channelId, threadTs, content, 'response.md', 'Full Response');
    } catch (err) {
      logger.warn(`file upload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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
      await client.postMessage(
        channelId,
        threadTs,
        'Handling too many conversations right now. Try again shortly.',
      );
      logger.warn('Handling too many conversations right now. Try again shortly.');
      return;
    }

    lock.processing = true;
    activeSpawns++;

    try {
      const resolved = resolveSession(channelId, threadTs, config);
      if (!resolved) {
        await client.postMessage(channelId, threadTs, 'No agent configured for this channel.');
        return;
      }

      const { session, agent, isNew } = resolved;

      for (const msg of messages) {
        db.logMessage(channelId, threadTs, msg.userId, 'in', msg.text);
      }
      db.touchSession(session.id, messages.length + 1);
      broadcastSSE('invalidate', { resource: 'sessions' });

      const prompt = formatPrompt(messages);
      const lastMessage = messages[messages.length - 1]!;

      await client.addReaction(channelId, lastMessage.timestamp, 'hourglass_flowing_sand');

      const sessionId = isNew ? undefined : session.provider_session_id || undefined;
      const { events, kill } = spawnProvider(
        agent.provider,
        { message: prompt, sessionId, agent, mcpConfigPath: config.browser.mcpConfigPath },
        signal,
      );

      lock.killCurrent = kill;

      await streamToChannel(events, channelId, threadTs, session.id);

      await client.removeReaction(channelId, lastMessage.timestamp, 'hourglass_flowing_sand');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`handler error: ${errMsg}`);
      recordError('handler');
      db.insertLog('error', 'handler', errMsg, channelId);
      try {
        await client.postMessage(channelId, threadTs, `Something went wrong: ${errMsg}`);
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

function splitByBytes(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxBytes;
    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }
    while (end > start && Buffer.byteLength(text.slice(start, end), 'utf8') > maxBytes) {
      end--;
    }
    if (end === start) {
      end = start + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}

function trimToBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;

  let end = maxBytes;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) {
    end--;
  }
  return text.slice(0, end);
}

/** @fileoverview Core orchestration: session resolution, spawn, stream-to-channel. */

import type { Config } from '../core/types.ts';
import type { CoalesceDispatch } from './coalesce.ts';
import type { ChannelClient } from './types.ts';

import { resolveSession } from '../provider/session.ts';
import { spawnProvider } from '../provider/spawn.ts';
import * as db from '../db/index.ts';
import { resolveExtraEnv } from '../db/keys.ts';
import { getDocsSystemPrompt } from '../db/docs.ts';
import { logger } from '../core/logger.ts';
import { broadcastSSE } from '../server/index.ts';
import { sessionErrorBlocks, busyBlocks, noAgentBlocks } from './blocks.ts';
import { streamToChannel, BROWSER_TOOL_PREFIX } from './stream.ts';
import { acquireBrowserLockWithHeartbeat } from '../browser/lock.ts';
import type { BrowserLockHandle } from '../browser/lock.ts';
import { getBrowserMode } from '../config.ts';

interface SessionLock {
  processing: boolean;
  queue: CoalesceDispatch[];
  killCurrent: (() => void) | null;
}

export interface Handler {
  handle(dispatch: CoalesceDispatch): Promise<void>;
  activeCount(): number;
  killAll(): void;
  killSession(key: string): boolean;
}

export function createHandler(
  client: ChannelClient,
  getConfig: () => Config,
  signal: AbortSignal,
  getTeamId: () => string,
  getChannelNameToId?: () => Map<string, string>,
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

    const config = getConfig();

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

    const needsBrowserLock = config.browser.enabled && getBrowserMode() === 'persistent';
    const browser = { lock: null as BrowserLockHandle | null };

    lock.processing = true;
    activeSpawns++;

    let sessionUid: string | undefined;
    try {
      const resolved = resolveSession(channelId, threadTs, config, getChannelNameToId?.());
      if (!resolved) {
        const blocks = noAgentBlocks(channelId);
        await client.postMessage(channelId, threadTs, 'No agent configured for this channel.', {
          blocks,
        });
        return;
      }

      const { session, agent, isNew } = resolved;
      sessionUid = session.uid;

      for (const msg of messages) {
        db.logMessage(channelId, threadTs, msg.userId, 'in', msg.text);
      }
      db.touchSession(session.uid, messages.length);
      broadcastSSE('invalidate', { resource: 'sessions' });

      const prompt = formatPrompt(messages);
      const lastMessage = messages[messages.length - 1]!;
      const userId = lastMessage.userId;

      const targets: Array<{ type: 'channel' | 'bird'; id: string }> = [
        { type: 'channel', id: channelId },
      ];
      const extraEnv = resolveExtraEnv(targets);

      const existingSessionId = isNew ? undefined : session.provider_session_id || undefined;
      const { events, kill } = spawnProvider(
        {
          message: prompt,
          sessionId: existingSessionId,
          agent,
          mcpConfigPath: config.browser.mcpConfigPath,
          timezone: config.timezone,
          globalTimeoutMs: config.sessions.processTimeoutMs,
          extraEnv,
          docsPrompt: getDocsSystemPrompt(targets),
        },
        signal,
      );

      lock.killCurrent = kill;

      client.setStatus?.(channelId, threadTs, 'is thinking...').catch(() => {});

      if (isNew) {
        const title = prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;
        client.setTitle?.(channelId, threadTs, title).catch(() => {});
      }

      const onToolUse = (toolName: string) => {
        if (!needsBrowserLock || browser.lock) return;
        if (!toolName.startsWith(BROWSER_TOOL_PREFIX)) return;

        browser.lock = acquireBrowserLockWithHeartbeat(key, config.sessions.processTimeoutMs);
        if (browser.lock) {
          logger.info(`browser lock acquired lazily for ${key} (tool: ${toolName})`);
        } else {
          logger.warn(`browser lock unavailable for ${key} (tool: ${toolName})`);
          client
            .postMessage(channelId, threadTs, 'The browser is in use by another session.')
            .catch(() => {});
        }
      };

      await streamToChannel(
        client,
        signal,
        events,
        { channelId, threadTs, teamId: getTeamId(), userId },
        {
          sessionUid: session.uid,
          birdName: agent.name,
          onToolUse,
        },
        {
          onInit: (sessionId) => db.updateSessionProviderId(session.uid, sessionId),
          onCompletion: (fullText, completion) => {
            db.logMessage(
              channelId,
              threadTs,
              'bot',
              'out',
              fullText,
              completion.tokensIn,
              completion.tokensOut,
            );
          },
          onError: (error) => db.insertLog('error', 'spawn', error, channelId),
        },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`handler error: ${errMsg}`);
      db.insertLog('error', 'handler', errMsg, channelId);
      try {
        const blocks = sessionErrorBlocks(errMsg, { sessionUid });
        await client.postMessage(channelId, threadTs, `Something went wrong: ${errMsg}`, {
          blocks,
        });
      } catch {
        /* channel may no longer be accessible */
      }
    } finally {
      browser.lock?.release();
      activeSpawns--;
      lock.processing = false;
      lock.killCurrent = null;

      const next = lock.queue.shift();
      if (next) {
        handle(next).catch((err: unknown) => {
          logger.error(`dispatch error: ${err instanceof Error ? err.message : String(err)}`);
        });
      } else if (lock.queue.length === 0) {
        locks.delete(key);
      }
    }
  }

  function activeCount(): number {
    return activeSpawns;
  }

  function killSession(key: string): boolean {
    const lock = locks.get(key);
    if (!lock?.killCurrent) return false;
    lock.killCurrent();
    lock.queue.length = 0;
    return true;
  }

  function killAll(): void {
    for (const lock of locks.values()) {
      lock.killCurrent?.();
      lock.queue.length = 0;
    }
    locks.clear();
  }

  return { handle, activeCount, killAll, killSession };
}

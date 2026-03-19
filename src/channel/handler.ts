/** @fileoverview Core orchestration: session resolution, spawn, stream-to-channel. */

import type { Config } from '../core/types.ts';
import type { CoalesceDispatch } from './coalesce.ts';
import type { StreamEvent, StreamEventCompletion, ToolImage } from '../provider/stream.ts';
import type { ChannelClient, StreamChunk, StreamHandle } from './types.ts';

import { resolveSession } from '../provider/session.ts';
import { spawnProvider } from '../provider/spawn.ts';
import * as db from '../db/index.ts';
import { logger } from '../core/logger.ts';
import { redact } from '../core/redact.ts';
import { broadcastSSE } from '../server/index.ts';
import {
  sessionErrorBlocks,
  busyBlocks,
  noAgentBlocks,
  completionFooterBlocks,
  sessionTimeoutBlocks,
} from './blocks.ts';
import { acquireBrowserLockWithHeartbeat } from '../browser/lock.ts';
import type { BrowserLockHandle } from '../browser/lock.ts';
import { getBrowserMode } from '../config.ts';

const BROWSER_TOOL_PREFIX = 'mcp__playwright__';
const STATUS_REFRESH_MS = 90_000;

function toolStatusText(toolName: string): string {
  if (toolName.startsWith(BROWSER_TOOL_PREFIX)) return 'is using the browser...';
  if (toolName.startsWith('mcp__')) return 'is using a tool...';
  if (toolName === 'Bash') return 'is running a command...';
  if (toolName === 'Read' || toolName === 'Grep' || toolName === 'Glob')
    return 'is reading files...';
  if (toolName === 'Edit' || toolName === 'Write') return 'is writing code...';
  return 'is working...';
}

function toolTaskTitle(toolName: string): string {
  if (toolName.startsWith(BROWSER_TOOL_PREFIX)) {
    const action = toolName.slice(BROWSER_TOOL_PREFIX.length);
    return `Browser: ${action}`;
  }
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.slice('mcp__'.length).split('__');
    const server = parts[0] ?? 'mcp';
    const action = parts.slice(1).join('__') || 'call';
    return `${server}: ${action}`;
  }
  switch (toolName) {
    case 'Bash':
      return 'Running command';
    case 'Read':
      return 'Reading file';
    case 'Grep':
      return 'Searching code';
    case 'Glob':
      return 'Finding files';
    case 'Edit':
      return 'Editing file';
    case 'Write':
      return 'Writing file';
    case 'Agent':
      return 'Running sub-agent';
    default:
      return toolName;
  }
}

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

  async function streamToChannel(
    events: AsyncIterable<StreamEvent>,
    channelId: string,
    threadTs: string,
    sessionUid: string,
    teamId: string,
    userId: string,
    meta: { birdName?: string; onToolUse?: (toolName: string) => void },
  ): Promise<void> {
    const streamer = client.startStream({ channelId, threadTs, teamId, userId });
    let streamDead = false;
    let fullText = '';
    let completion: StreamEventCompletion | undefined;
    let hasError = false;
    let timedOut = false;
    let timedOutMs = 0;

    const activeTasks = new Map<string, string>();
    let toolCount = 0;
    let toolErrors = 0;
    let toolSuccesses = 0;

    function isStreamExpired(err: unknown): boolean {
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes('not_in_streaming_state') || msg.includes('streaming');
    }

    async function safeAppend(content: {
      markdown_text?: string;
      chunks?: StreamChunk[];
    }): Promise<void> {
      if (streamDead) {
        if (content.markdown_text) {
          await client.postMessage(channelId, threadTs, content.markdown_text).catch(() => {});
        }
        return;
      }
      try {
        await streamer.append(content);
      } catch (err) {
        if (isStreamExpired(err)) {
          streamDead = true;
          logger.warn('slack stream expired, falling back to regular messages');
        } else {
          throw err;
        }
      }
    }

    async function safeStop(opts?: Parameters<StreamHandle['stop']>[0]): Promise<void> {
      if (streamDead) {
        if (opts?.blocks) {
          await client
            .postMessage(channelId, threadTs, '', { blocks: opts.blocks })
            .catch(() => {});
        }
        return;
      }
      try {
        await streamer.stop(opts);
      } catch (err) {
        if (isStreamExpired(err)) {
          streamDead = true;
        } else {
          throw err;
        }
      }
    }

    let lastStatus = 'is thinking...';
    const refreshStatus = () => {
      client.setStatus?.(channelId, threadTs, lastStatus).catch(() => {});
    };
    const statusTimer = setInterval(refreshStatus, STATUS_REFRESH_MS);

    for await (const event of events) {
      if (signal.aborted) break;
      logger.debug(`stream event: ${event.type}`);

      switch (event.type) {
        case 'init':
          db.updateSessionProviderId(sessionUid, event.sessionId);
          break;

        case 'text_delta': {
          const safe = redact(event.delta);
          fullText += safe;
          await safeAppend({ markdown_text: safe });
          break;
        }

        case 'tool_images':
          await uploadImages(event.images, channelId, threadTs);
          break;

        case 'tool_use': {
          meta.onToolUse?.(event.toolName);
          lastStatus = toolStatusText(event.toolName);
          client.setStatus?.(channelId, threadTs, lastStatus).catch(() => {});

          if (event.toolCallId !== undefined) {
            toolCount++;
            activeTasks.set(event.toolCallId, event.toolName);
            const title = toolTaskTitle(event.toolName);
            const chunks: StreamChunk[] = [];
            if (toolCount === 1) {
              chunks.push({ type: 'plan_update', title: 'Working on it' });
            }
            chunks.push({
              type: 'task_update',
              id: event.toolCallId,
              title,
              status: 'in_progress',
              ...(event.details ? { details: event.details } : {}),
            });
            await safeAppend({ chunks });
          }
          break;
        }

        case 'tool_result': {
          const toolName = activeTasks.get(event.toolCallId);
          if (toolName) {
            activeTasks.delete(event.toolCallId);
            const title = toolTaskTitle(toolName);
            if (event.isError) {
              toolErrors++;
            } else {
              toolSuccesses++;
            }
            const chunks: StreamChunk[] = [
              {
                type: 'task_update',
                id: event.toolCallId,
                title,
                status: event.isError ? 'error' : 'complete',
                ...(event.output ? { output: event.output } : {}),
              },
            ];
            if (activeTasks.size === 0) {
              const label =
                toolErrors === 0
                  ? `Completed (${toolCount} ${toolCount === 1 ? 'step' : 'steps'})`
                  : `${toolSuccesses} passed, ${toolErrors} failed`;
              chunks.push({ type: 'plan_update', title: label });
            }
            await safeAppend({ chunks });
          }
          break;
        }

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

        case 'error': {
          hasError = true;
          const safeError = redact(event.error);
          logger.error(`agent error: ${safeError}`);
          db.insertLog('error', 'spawn', safeError, channelId);
          await safeAppend({ markdown_text: `\n\nError: ${safeError}` });
          break;
        }

        case 'timeout':
          timedOut = true;
          timedOutMs = event.timeoutMs;
          logger.warn(`session timed out after ${event.timeoutMs}ms`);
          break;
      }
    }

    clearInterval(statusTimer);
    client.setStatus?.(channelId, threadTs, '').catch(() => {});

    if (activeTasks.size > 0) {
      const staleChunks: StreamChunk[] = [];
      for (const [id, toolName] of activeTasks) {
        staleChunks.push({
          type: 'task_update',
          id,
          title: toolTaskTitle(toolName),
          status: 'error',
        });
      }
      await safeAppend({ chunks: staleChunks });
      activeTasks.clear();
    }

    if (toolCount > 0 && (hasError || activeTasks.size > 0)) {
      const planTitle = hasError
        ? 'Finished with errors'
        : `Interrupted (${toolCount} ${toolCount === 1 ? 'step' : 'steps'})`;
      await safeAppend({ chunks: [{ type: 'plan_update', title: planTitle }] });
    }

    if (timedOut) {
      await safeStop({});
      const blocks = sessionTimeoutBlocks(timedOutMs, { sessionUid });
      await client.postMessage(
        channelId,
        threadTs,
        `Session timed out after ${Math.round(timedOutMs / 60_000)} minutes.`,
        { blocks },
      );
    } else if (completion) {
      const footerBlocks = completionFooterBlocks(completion, hasError, meta.birdName, userId);
      await safeStop({ blocks: footerBlocks });
    } else {
      if (!fullText) {
        await safeAppend({ markdown_text: '_Stopped._' });
      }
      await safeStop({});
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

      const existingSessionId = isNew ? undefined : session.provider_session_id || undefined;
      const { events, kill } = spawnProvider(
        {
          message: prompt,
          sessionId: existingSessionId,
          agent,
          mcpConfigPath: config.browser.mcpConfigPath,
          timezone: config.timezone,
          globalTimeoutMs: config.sessions.processTimeoutMs,
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

      await streamToChannel(events, channelId, threadTs, session.uid, getTeamId(), userId, {
        birdName: agent.name,
        onToolUse,
      });
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

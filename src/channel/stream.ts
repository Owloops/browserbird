/** @fileoverview Reusable stream-to-channel logic for both conversations and birds. */

import type { StreamEvent, StreamEventCompletion, ToolImage } from '../provider/stream.ts';
import type { ChannelClient, StreamChunk, StreamHandle, StreamStartOptions } from './types.ts';

import { logger } from '../core/logger.ts';
import { redact } from '../core/redact.ts';
import { completionFooterBlocks, sessionTimeoutBlocks } from './blocks.ts';

export const BROWSER_TOOL_PREFIX = 'mcp__playwright__';

const STREAM_CHAR_LIMIT = 30_000;
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

function isStreamExpired(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('not_in_streaming_state') ||
    msg.includes('streaming') ||
    msg.includes('msg_too_long')
  );
}

export interface StreamToChannelMeta {
  sessionUid?: string;
  birdName?: string;
  onToolUse?: (toolName: string) => void;
}

export interface StreamToChannelCallbacks {
  onInit?: (sessionId: string) => void;
  onCompletion?: (fullText: string, completion: StreamEventCompletion) => void;
  onError?: (error: string) => void;
}

export interface StreamToChannelResult {
  fullText: string;
  completion?: StreamEventCompletion;
  error?: string;
}

export async function streamToChannel(
  client: ChannelClient,
  signal: AbortSignal,
  events: AsyncIterable<StreamEvent>,
  target: StreamStartOptions,
  meta: StreamToChannelMeta,
  callbacks?: StreamToChannelCallbacks,
): Promise<StreamToChannelResult> {
  const { channelId, threadTs, userId } = target;
  let streamer = client.startStream(target);
  let streamDead = false;
  let streamedChars = 0;
  let fullText = '';
  let completion: StreamEventCompletion | undefined;
  let lastError: string | undefined;
  let timedOut = false;
  let timedOutMs = 0;

  const activeTasks = new Map<string, string>();
  let toolCount = 0;
  let toolErrors = 0;
  let toolSuccesses = 0;

  let streamToolCount = 0;
  let needsPlanHeader = true;

  async function resetStream(): Promise<void> {
    try {
      await streamer.stop();
    } catch {
      /* stream may already be dead */
    }
    streamer = client.startStream(target);
    streamedChars = 0;
    streamToolCount = 0;
    needsPlanHeader = true;
    logger.debug('stream reset: started new streaming message');
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

    const textLen = content.markdown_text?.length ?? 0;
    if (textLen > 0 && streamedChars + textLen > STREAM_CHAR_LIMIT) {
      await resetStream();
    }

    try {
      await streamer.append(content);
      streamedChars += textLen;
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
        await client.postMessage(channelId, threadTs, '', { blocks: opts.blocks }).catch(() => {});
      }
      return;
    }
    try {
      await streamer.stop(opts);
    } catch (err) {
      if (isStreamExpired(err)) {
        streamDead = true;
      } else {
        await streamer.stop().catch(() => {});
        throw err;
      }
    }
  }

  let lastStatus = 'is thinking...';
  const refreshStatus = () => {
    client.setStatus?.(channelId, threadTs, lastStatus).catch(() => {});
  };
  const statusTimer = setInterval(refreshStatus, STATUS_REFRESH_MS);

  try {
    for await (const event of events) {
      if (signal.aborted) break;
      logger.debug(`stream event: ${event.type}`);

      switch (event.type) {
        case 'init':
          callbacks?.onInit?.(event.sessionId);
          break;

        case 'text_delta': {
          const safe = redact(event.delta);
          fullText += safe;
          await safeAppend({ markdown_text: safe });
          break;
        }

        case 'tool_images':
          await uploadImages(client, event.images, channelId, threadTs);
          break;

        case 'tool_use': {
          meta.onToolUse?.(event.toolName);
          lastStatus = toolStatusText(event.toolName);
          client.setStatus?.(channelId, threadTs, lastStatus).catch(() => {});

          if (event.toolCallId !== undefined) {
            toolCount++;
            streamToolCount++;
            activeTasks.set(event.toolCallId, event.toolName);
            const title = toolTaskTitle(event.toolName);
            const chunks: StreamChunk[] = [];
            if (needsPlanHeader) {
              chunks.push({ type: 'plan_update', title: 'Working on it' });
              needsPlanHeader = false;
            }
            chunks.push({
              type: 'task_update',
              id: event.toolCallId,
              title,
              status: 'in_progress',
              ...(event.details ? { details: redact(event.details) } : {}),
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
                ...(event.output ? { output: redact(event.output) } : {}),
              },
            ];
            if (activeTasks.size === 0) {
              const label =
                toolErrors === 0
                  ? `Completed (${streamToolCount} ${streamToolCount === 1 ? 'step' : 'steps'})`
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
          callbacks?.onCompletion?.(fullText, event);
          break;

        case 'rate_limit':
          logger.debug(`rate limit window resets ${new Date(event.resetsAt * 1000).toISOString()}`);
          break;

        case 'error': {
          const safeError = redact(event.error);
          lastError = safeError;
          logger.error(`agent error: ${safeError}`);
          callbacks?.onError?.(safeError);
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

    if (toolCount > 0 && (lastError != null || activeTasks.size > 0)) {
      const planTitle =
        lastError != null
          ? 'Finished with errors'
          : `Interrupted (${toolCount} ${toolCount === 1 ? 'step' : 'steps'})`;
      await safeAppend({ chunks: [{ type: 'plan_update', title: planTitle }] });
    }

    if (timedOut) {
      await safeStop({});
      const blocks = sessionTimeoutBlocks(timedOutMs, {
        sessionUid: meta.sessionUid,
      });
      await client.postMessage(
        channelId,
        threadTs,
        `Session timed out after ${Math.round(timedOutMs / 60_000)} minutes.`,
        { blocks },
      );
    } else if (completion) {
      const footerBlocks = completionFooterBlocks(
        completion,
        lastError != null,
        meta.birdName,
        userId,
      );
      await safeStop({ blocks: footerBlocks });
    } else {
      if (!fullText) {
        await safeAppend({ markdown_text: '_Stopped._' });
      }
      await safeStop({});
    }
  } finally {
    clearInterval(statusTimer);
    client.setStatus?.(channelId, threadTs, '').catch(() => {});
  }

  return { fullText, completion, error: lastError };
}

async function uploadImages(
  client: ChannelClient,
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

/** @fileoverview Web channel client: bridges the web UI chat to the handler pipeline via SSE. */

import type { Config } from '../core/types.ts';
import type {
  ChannelClient,
  MessageOptions,
  StreamChunk,
  StreamHandle,
  StreamStartOptions,
} from './types.ts';
import type { CoalesceDispatch } from './coalesce.ts';
import type { Handler } from './handler.ts';

import { createHandler } from './handler.ts';
import { broadcastSSE } from '../server/index.ts';
import { logger } from '../core/logger.ts';
import { randomUUID } from 'node:crypto';

interface ChatStreamPayload {
  sessionUid: string;
  subtype: 'append' | 'stop' | 'message' | 'status' | 'title' | 'image' | 'error';
  markdownText?: string;
  text?: string;
  status?: string;
  title?: string;
  imageData?: string;
  imageFilename?: string;
  chunks?: StreamChunk[];
}

function broadcast(payload: ChatStreamPayload): void {
  broadcastSSE('chat_stream', payload);
}

class WebStreamHandle implements StreamHandle {
  private readonly sessionUid: string;

  constructor(opts: StreamStartOptions) {
    this.sessionUid = opts.threadTs;
  }

  async append(args: { markdown_text?: string; chunks?: StreamChunk[] }): Promise<void> {
    broadcast({
      sessionUid: this.sessionUid,
      subtype: 'append',
      markdownText: args.markdown_text,
      chunks: args.chunks,
    });
  }

  async stop(args?: { blocks?: unknown[]; chunks?: StreamChunk[] }): Promise<void> {
    broadcast({
      sessionUid: this.sessionUid,
      subtype: 'stop',
      chunks: args?.chunks,
    });
  }
}

class WebChannelClient implements ChannelClient {
  async postMessage(
    _channelId: string,
    threadTs: string,
    text: string,
    _opts?: MessageOptions,
  ): Promise<string> {
    broadcast({ sessionUid: threadTs, subtype: 'message', text });
    return randomUUID();
  }

  async postEphemeral(): Promise<void> {}

  async uploadFile(
    _channelId: string,
    threadTs: string,
    content: Buffer,
    filename: string,
    _title: string,
  ): Promise<void> {
    broadcast({
      sessionUid: threadTs,
      subtype: 'image',
      imageData: content.toString('base64'),
      imageFilename: filename,
    });
  }

  startStream(opts: StreamStartOptions): StreamHandle {
    return new WebStreamHandle(opts);
  }

  async setStatus(_channelId: string, threadTs: string, status: string): Promise<void> {
    broadcast({ sessionUid: threadTs, subtype: 'status', status });
  }

  async setTitle(_channelId: string, threadTs: string, title: string): Promise<void> {
    broadcast({ sessionUid: threadTs, subtype: 'title', title });
  }

  async setSuggestedPrompts(): Promise<void> {}
}

export interface WebChannel {
  sendMessage(channelId: string, threadId: string, text: string): void;
  killSession(channelId: string, threadId: string): boolean;
  activeCount(): number;
}

export function createWebChannel(getConfig: () => Config, signal: AbortSignal): WebChannel {
  const client = new WebChannelClient();
  const handler: Handler = createHandler(client, getConfig, signal, () => 'web');

  function sendMessage(channelId: string, threadId: string, text: string): void {
    const dispatch: CoalesceDispatch = {
      channelId,
      threadTs: threadId,
      messages: [
        {
          userId: 'web-user',
          text,
          timestamp: String(Date.now() / 1000),
        },
      ],
    };
    handler.handle(dispatch).catch((err: unknown) => {
      logger.error(`web chat dispatch error: ${err instanceof Error ? err.message : String(err)}`);
      broadcast({
        sessionUid: threadId,
        subtype: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    });
  }

  function killSession(channelId: string, threadId: string): boolean {
    return handler.killSession(`${channelId}:${threadId}`);
  }

  function activeCount(): number {
    return handler.activeCount();
  }

  return { sendMessage, killSession, activeCount };
}

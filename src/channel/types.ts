/** @fileoverview Platform-agnostic channel client interface. */

import type { Block, ModalView } from './blocks.ts';

export interface MessageOptions {
  blocks?: Block[];
}

export interface StreamHandle {
  append(args: { markdown_text?: string }): Promise<unknown>;
  stop(args?: { blocks?: Block[] }): Promise<unknown>;
}

export interface StreamStartOptions {
  channelId: string;
  threadTs: string;
  teamId: string;
  userId: string;
}

export interface ChannelClient {
  postMessage(
    channelId: string,
    threadTs: string,
    text: string,
    opts?: MessageOptions,
  ): Promise<string>;
  postEphemeral(
    channelId: string,
    threadTs: string,
    userId: string,
    text: string,
    opts?: MessageOptions,
  ): Promise<void>;
  uploadFile(
    channelId: string,
    threadTs: string,
    content: Buffer,
    filename: string,
    title: string,
  ): Promise<void>;
  startStream(opts: StreamStartOptions): StreamHandle;
  openModal?(triggerId: string, view: ModalView): Promise<void>;
  setStatus?(channelId: string, threadTs: string, status: string): Promise<void>;
  setTitle?(channelId: string, threadTs: string, title: string): Promise<void>;
  setSuggestedPrompts?(
    channelId: string,
    threadTs: string,
    prompts: Array<{ title: string; message: string }>,
  ): Promise<void>;
}

export interface ChannelHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
  activeCount(): number;
  postMessage(channel: string, text: string, opts?: MessageOptions): Promise<void>;
}

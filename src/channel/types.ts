/** @fileoverview Platform-agnostic channel client interface. */

import type { Block, ModalView } from './blocks.ts';

export interface MessageOptions {
  blocks?: Block[];
}

export interface MarkdownTextChunk {
  type: 'markdown_text';
  text: string;
}

export interface TaskUpdateChunk {
  type: 'task_update';
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'complete' | 'error';
  details?: string;
  output?: string;
}

export interface PlanUpdateChunk {
  type: 'plan_update';
  title: string;
}

export type StreamChunk = MarkdownTextChunk | TaskUpdateChunk | PlanUpdateChunk;

export interface StreamHandle {
  append(args: { markdown_text?: string; chunks?: StreamChunk[] }): Promise<unknown>;
  stop(args?: { blocks?: Block[]; chunks?: StreamChunk[] }): Promise<unknown>;
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
    title?: string,
  ): Promise<void>;
}

export interface ChannelHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
  activeCount(): number;
  postMessage(channel: string, text: string, opts?: MessageOptions): Promise<string>;
  setTitle(channelId: string, threadTs: string, title: string): Promise<void>;
  resolveChannelNames(): Promise<void>;
}

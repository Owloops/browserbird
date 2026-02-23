/** @fileoverview Platform-agnostic channel client interface. */

export interface ChannelClient {
  postMessage(channelId: string, threadTs: string, text: string): Promise<string>;
  editMessage(channelId: string, messageId: string, text: string): Promise<void>;
  postEphemeral(channelId: string, threadTs: string, userId: string, text: string): Promise<void>;
  uploadFile(
    channelId: string,
    threadTs: string,
    content: Buffer,
    filename: string,
    title: string,
  ): Promise<void>;
  addReaction(channelId: string, messageId: string, name: string): Promise<void>;
  removeReaction(channelId: string, messageId: string, name: string): Promise<void>;
}

export interface ChannelHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
  activeCount(): number;
  postMessage(channel: string, text: string): Promise<void>;
}

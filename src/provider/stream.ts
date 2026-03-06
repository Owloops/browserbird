/** @fileoverview Shared stream event types and line-splitting utility. */

interface StreamEventInit {
  type: 'init';
  sessionId: string;
  model: string;
}

interface StreamEventTextDelta {
  type: 'text_delta';
  delta: string;
}

export interface ToolImage {
  mediaType: string;
  data: string;
}

interface StreamEventToolImages {
  type: 'tool_images';
  images: ToolImage[];
}

export interface StreamEventCompletion {
  type: 'completion';
  subtype: string;
  result: string;
  sessionId: string;
  isError: boolean;
  tokensIn: number;
  tokensOut: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  numTurns: number;
}

interface StreamEventRateLimit {
  type: 'rate_limit';
  resetsAt: number;
  status: string;
}

interface StreamEventError {
  type: 'error';
  error: string;
}

export interface StreamEventToolUse {
  type: 'tool_use';
  toolName: string;
}

export type StreamEvent =
  | StreamEventInit
  | StreamEventTextDelta
  | StreamEventToolImages
  | StreamEventCompletion
  | StreamEventRateLimit
  | StreamEventError
  | StreamEventToolUse;

/**
 * Splits a raw data chunk into lines, handling partial lines across chunks.
 * Returns [completeLines, remainingPartial].
 */
export function splitLines(buffer: string, chunk: string): [string[], string] {
  const combined = buffer + chunk;
  const lines = combined.split('\n');
  const partial = lines.pop() ?? '';
  return [lines, partial];
}

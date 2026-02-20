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

interface StreamEventToolUse {
  type: 'tool_use';
  name: string;
  input: unknown;
}

export interface ToolImage {
  mediaType: string;
  data: string;
}

interface StreamEventToolResult {
  type: 'tool_result';
  name: string;
  output: string;
}

interface StreamEventToolImages {
  type: 'tool_images';
  images: ToolImage[];
}

interface StreamEventCompletion {
  type: 'completion';
  result: string;
  sessionId: string;
  tokensIn: number;
  tokensOut: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;
  numTurns: number;
}

interface StreamEventError {
  type: 'error';
  error: string;
}

export type StreamEvent =
  | StreamEventInit
  | StreamEventTextDelta
  | StreamEventToolUse
  | StreamEventToolResult
  | StreamEventToolImages
  | StreamEventCompletion
  | StreamEventError;

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

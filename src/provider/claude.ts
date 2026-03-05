/** @fileoverview Claude Code CLI provider: arg building and stream-json parsing. */

import { resolve } from 'node:path';
import type { ProviderModule, SpawnOptions, ProviderCommand } from './types.ts';
import type { StreamEvent, ToolImage } from './stream.ts';

type CompletionSubtype =
  | 'success'
  | 'error_max_turns'
  | 'error_during_execution'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries';

function buildCommand(options: SpawnOptions): ProviderCommand {
  const { message, sessionId, agent, mcpConfigPath } = options;

  const args: string[] = [
    '-p',
    message,
    '--output-format',
    'stream-json',
    '--model',
    agent.model,
    '--verbose',
    '--max-turns',
    String(agent.maxTurns),
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  if (agent.systemPrompt) {
    args.push('--append-system-prompt', agent.systemPrompt);
  }

  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath);
  }

  if (agent.fallbackModel) {
    args.push('--fallback-model', agent.fallbackModel);
  }

  args.push('--dangerously-skip-permissions');

  const oauthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const env: Record<string, string> = oauthToken
    ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken }
    : apiKey
      ? { ANTHROPIC_API_KEY: apiKey }
      : {};

  env['CLAUDE_CONFIG_DIR'] = resolve('.browserbird', 'claude');

  return { binary: 'claude', args, env };
}

/**
 * Parses a single line of stream-json output into zero or more StreamEvents.
 * Only extracts text, images, completion, and error events. Tool use/result
 * events are internal to the agent and not surfaced to the channel layer.
 */
function parseStreamLine(line: string): StreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }

  const eventType = parsed['type'] as string | undefined;
  if (!eventType) return [];

  switch (eventType) {
    case 'system':
      if (typeof parsed['session_id'] === 'string') {
        return [
          {
            type: 'init',
            sessionId: parsed['session_id'],
            model: (parsed['model'] as string) ?? '',
          },
        ];
      }
      return [];

    case 'assistant':
      return parseAssistantContent(parsed);

    case 'user':
      return extractImages(parsed);

    case 'result': {
      const usage = parsed['usage'] as Record<string, unknown> | undefined;
      const subtype = (parsed['subtype'] as CompletionSubtype | undefined) ?? 'success';
      return [
        {
          type: 'completion',
          subtype,
          result: typeof parsed['result'] === 'string' ? parsed['result'] : '',
          sessionId: (parsed['session_id'] as string) ?? '',
          isError: (parsed['is_error'] as boolean) ?? false,
          tokensIn: (usage?.['input_tokens'] as number) ?? 0,
          tokensOut: (usage?.['output_tokens'] as number) ?? 0,
          cacheCreationTokens: (usage?.['cache_creation_input_tokens'] as number) ?? 0,
          cacheReadTokens: (usage?.['cache_read_input_tokens'] as number) ?? 0,
          costUsd: (parsed['total_cost_usd'] as number) ?? 0,
          durationMs: (parsed['duration_ms'] as number) ?? 0,
          numTurns: (parsed['num_turns'] as number) ?? 0,
        },
      ];
    }

    case 'rate_limit_event': {
      const info = parsed['rate_limit_info'] as Record<string, unknown> | undefined;
      return [
        {
          type: 'rate_limit',
          status: (info?.['status'] as string) ?? 'unknown',
          resetsAt: (info?.['resetsAt'] as number) ?? 0,
        },
      ];
    }

    case 'error':
      return [
        {
          type: 'error',
          error:
            typeof parsed['error'] === 'string' ? parsed['error'] : JSON.stringify(parsed['error']),
        },
      ];

    default:
      return [];
  }
}

function parseAssistantContent(parsed: Record<string, unknown>): StreamEvent[] {
  const msg = parsed['message'];
  if (typeof msg === 'string') {
    return [{ type: 'text_delta', delta: msg }];
  }
  if (!msg || typeof msg !== 'object') return [];

  const content = (msg as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) return [];

  const events: StreamEvent[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      events.push({ type: 'text_delta', delta: b['text'] });
    }
  }
  return events;
}

function extractImages(parsed: Record<string, unknown>): StreamEvent[] {
  const msg = parsed['message'];
  if (!msg || typeof msg !== 'object') return [];
  const content = (msg as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) return [];

  const images: ToolImage[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] !== 'tool_result') continue;

    const inner = b['content'];
    if (!Array.isArray(inner)) continue;
    for (const item of inner) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      if (i['type'] !== 'image') continue;
      const source = i['source'] as Record<string, unknown> | undefined;
      if (!source || source['type'] !== 'base64') continue;
      images.push({
        mediaType: (source['media_type'] as string) ?? 'image/png',
        data: (source['data'] as string) ?? '',
      });
    }
  }

  if (images.length > 0) {
    return [{ type: 'tool_images', images }];
  }

  return [];
}

export const claude: ProviderModule = { buildCommand, parseStreamLine };

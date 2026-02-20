/** @fileoverview Claude Code CLI provider — arg building and stream-json parsing. */

import type { ProviderModule, SpawnOptions, ProviderCommand } from './types.ts';
import type { StreamEvent, ToolImage } from './stream.ts';

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

  return { binary: 'claude', args };
}

function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) {
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const eventType = parsed['type'] as string | undefined;
  if (!eventType) {
    return null;
  }

  switch (eventType) {
    case 'system':
      if (typeof parsed['session_id'] === 'string') {
        return {
          type: 'init',
          sessionId: parsed['session_id'],
          model: (parsed['model'] as string) ?? '',
        };
      }
      return null;

    case 'assistant': {
      const msg = parsed['message'];
      if (typeof msg === 'string') {
        return { type: 'text_delta', delta: msg };
      }
      if (msg && typeof msg === 'object') {
        const content = (msg as Record<string, unknown>)['content'];
        if (Array.isArray(content)) {
          const text = content
            .filter((b): b is Record<string, unknown> => b?.['type'] === 'text')
            .map((b) => b['text'] as string)
            .join('');
          if (text) {
            return { type: 'text_delta', delta: text };
          }
        }
      }
      return null;
    }

    case 'tool_use':
      return {
        type: 'tool_use',
        name: (parsed['tool'] as string) ?? 'unknown',
        input: parsed['input'] ?? null,
      };

    case 'tool_result':
      return {
        type: 'tool_result',
        name: (parsed['tool'] as string) ?? 'unknown',
        output:
          typeof parsed['output'] === 'string'
            ? parsed['output']
            : JSON.stringify(parsed['output']),
      };

    case 'user': {
      const msg = parsed['message'];
      if (!msg || typeof msg !== 'object') return null;
      const content = (msg as Record<string, unknown>)['content'];
      if (!Array.isArray(content)) return null;
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
      if (images.length === 0) return null;
      return { type: 'tool_images', images };
    }

    case 'result': {
      const usage = parsed['usage'] as Record<string, unknown> | undefined;
      return {
        type: 'completion',
        result: typeof parsed['result'] === 'string' ? parsed['result'] : '',
        sessionId: (parsed['session_id'] as string) ?? '',
        tokensIn: (usage?.['input_tokens'] as number) ?? 0,
        tokensOut: (usage?.['output_tokens'] as number) ?? 0,
        cacheCreationTokens: (usage?.['cache_creation_input_tokens'] as number) ?? 0,
        cacheReadTokens: (usage?.['cache_read_input_tokens'] as number) ?? 0,
        costUsd: (parsed['total_cost_usd'] as number) ?? 0,
        durationMs: (parsed['duration_ms'] as number) ?? 0,
        numTurns: (parsed['num_turns'] as number) ?? 0,
      };
    }

    case 'error':
      return {
        type: 'error',
        error:
          typeof parsed['error'] === 'string' ? parsed['error'] : JSON.stringify(parsed['error']),
      };

    default:
      return null;
  }
}

export const claude: ProviderModule = { buildCommand, parseStreamLine };

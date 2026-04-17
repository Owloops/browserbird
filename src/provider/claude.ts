/** @fileoverview Claude Code CLI provider: arg building and stream-json parsing. */

import { resolve } from 'node:path';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { DATA_DIR } from '../core/paths.ts';
import { DEFAULT_PERMISSION_MODE } from '../core/types.ts';
import type { StreamEvent, ToolImage } from './stream.ts';

interface ProviderCommand {
  binary: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface SpawnOptions {
  message: string;
  sessionId?: string;
  agent: import('../core/types.ts').AgentConfig;
  mcpConfigPath?: string;
  timezone?: string;
  globalTimeoutMs?: number;
  extraEnv?: Record<string, string>;
  docsPrompt?: string;
}

type CompletionSubtype =
  | 'success'
  | 'error_max_turns'
  | 'error_during_execution'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries';

export function buildCommand(options: SpawnOptions): ProviderCommand {
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

  const systemParts: string[] = [];
  if (agent.systemPrompt) systemParts.push(agent.systemPrompt);
  if (options.docsPrompt) systemParts.push(options.docsPrompt);
  if (options.timezone)
    systemParts.push(
      `System timezone: ${options.timezone}. All cron expressions and scheduled times use this timezone.`,
    );
  if (systemParts.length > 0) {
    args.push('--append-system-prompt', systemParts.join(' '));
  }

  args.push('--strict-mcp-config');
  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath);
  }

  if (agent.fallbackModel) {
    args.push('--fallback-model', agent.fallbackModel);
  }

  if (agent.maxBudgetUsd) {
    args.push('--max-budget-usd', String(agent.maxBudgetUsd));
  }

  args.push('--permission-mode', agent.permissionMode ?? DEFAULT_PERMISSION_MODE);
  args.push('--disable-slash-commands');

  const oauthToken = process.env['CLAUDE_CODE_OAUTH_TOKEN'];
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const env: Record<string, string> = oauthToken
    ? { CLAUDE_CODE_OAUTH_TOKEN: oauthToken }
    : apiKey
      ? { ANTHROPIC_API_KEY: apiKey }
      : {};

  const configDir = resolve(DATA_DIR, 'claude');
  ensureClaudeSettings(configDir);
  env['CLAUDE_CONFIG_DIR'] = configDir;

  return { binary: 'claude', args, env };
}

const CLAUDE_SETTINGS = {
  enabledPlugins: {
    'lua-lsp@claude-plugins-official': true,
    'gopls-lsp@claude-plugins-official': true,
    'frontend-design@claude-plugins-official': true,
  },
  alwaysThinkingEnabled: false,
  effortLevel: 'high',
  fastMode: false,
  permissions: {
    deny: ['Bash(sudo rm *)', 'Bash(sudo reboot*)', 'Bash(sudo shutdown*)'],
  },
};

let settingsEnsured = false;

function ensureClaudeSettings(configDir: string): void {
  if (settingsEnsured) return;
  settingsEnsured = true;

  const settingsPath = resolve(configDir, 'settings.json');
  if (existsSync(settingsPath)) return;

  mkdirSync(configDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(CLAUDE_SETTINGS, null, 2) + '\n');
}

/** Parses a single line of stream-json output into zero or more StreamEvents. */
export function parseStreamLine(line: string): StreamEvent[] {
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
            apiKeySource: (parsed['apiKeySource'] as string) ?? '',
          },
        ];
      }
      return [];

    case 'assistant':
      return parseAssistantContent(parsed);

    case 'user':
      return parseUserContent(parsed);

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

    case 'tool_progress': {
      const toolUseId = parsed['tool_use_id'];
      const toolName = parsed['tool_name'];
      const elapsed = parsed['elapsed_time_seconds'];
      if (
        typeof toolUseId === 'string' &&
        typeof toolName === 'string' &&
        typeof elapsed === 'number'
      ) {
        return [
          { type: 'tool_progress', toolCallId: toolUseId, toolName, elapsedSeconds: elapsed },
        ];
      }
      return [];
    }

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
    } else if (b['type'] === 'tool_use' && typeof b['name'] === 'string') {
      const input = b['input'] as Record<string, unknown> | undefined;
      events.push({
        type: 'tool_use',
        toolName: b['name'],
        toolCallId: typeof b['id'] === 'string' ? b['id'] : undefined,
        details: extractToolDetails(b['name'], input),
      });
    }
  }
  return events;
}

function parseUserContent(parsed: Record<string, unknown>): StreamEvent[] {
  const msg = parsed['message'];
  if (!msg || typeof msg !== 'object') return [];
  const content = (msg as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) return [];

  const events: StreamEvent[] = [];
  const images: ToolImage[] = [];

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b['type'] !== 'tool_result') continue;

    const toolUseId = b['tool_use_id'];
    if (typeof toolUseId === 'string') {
      events.push({
        type: 'tool_result',
        toolCallId: toolUseId,
        isError: b['is_error'] === true,
        output: extractToolOutput(b['content']),
      });
    }

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
    events.push({ type: 'tool_images', images });
  }

  return events;
}

const MAX_DETAIL_LENGTH = 120;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function extractToolDetails(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined;

  if (toolName === 'Bash') {
    const desc = input['description'] as string | undefined;
    const cmd = input['command'] as string | undefined;
    return truncate(desc || cmd || '', MAX_DETAIL_LENGTH) || undefined;
  }
  if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
    const filePath = input['file_path'] as string | undefined;
    return filePath || undefined;
  }
  if (toolName === 'Grep') {
    const pattern = input['pattern'] as string | undefined;
    const path = input['path'] as string | undefined;
    if (!pattern) return undefined;
    return path ? `${pattern} in ${path}` : pattern;
  }
  if (toolName === 'Glob') {
    return (input['pattern'] as string | undefined) || undefined;
  }
  if (toolName === 'WebSearch') {
    return (input['query'] as string | undefined) || undefined;
  }
  if (toolName === 'WebFetch') {
    return (input['url'] as string | undefined) || undefined;
  }

  if (toolName.startsWith('mcp__playwright__')) {
    const url = input['url'] as string | undefined;
    if (url) return url;
  }

  return undefined;
}

function extractToolOutput(content: unknown): string | undefined {
  if (typeof content === 'string') {
    const lines = content.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return undefined;
    if (lines.length === 1) return truncate(lines[0]!, MAX_DETAIL_LENGTH);
    return `${lines.length} lines of output`;
  }
  return undefined;
}

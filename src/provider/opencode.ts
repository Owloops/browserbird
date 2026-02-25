/** @fileoverview OpenCode CLI provider — arg building, workspace setup, and JSON stream parsing. */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProviderModule, SpawnOptions, ProviderCommand } from './types.ts';
import type { StreamEvent } from './stream.ts';
import { logger } from '../core/logger.ts';

const WORKSPACE_DIR = resolve('.browserbird', 'opencode');

/**
 * Translates a Claude-format MCP config into an opencode-format config.
 *
 * Claude format:  { mcpServers: { name: { type: "sse", url: "..." } } }
 * OpenCode format: { mcp: { name: { type: "remote", url: "..." } } }
 */
function translateMcpConfig(
  claudeConfig: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const servers = (claudeConfig['mcpServers'] ?? {}) as Record<string, Record<string, unknown>>;
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, server] of Object.entries(servers)) {
    const serverType = server['type'] as string | undefined;
    const url = server['url'] as string | undefined;
    const command = server['command'] as string | undefined;
    const args = server['args'] as string[] | undefined;

    if (serverType === 'sse' || serverType === 'streamable-http') {
      if (url) {
        result[name] = { type: 'remote', url };
      }
    } else if (serverType === 'stdio') {
      if (command) {
        const cmd = args ? [command, ...args] : [command];
        const entry: Record<string, unknown> = { type: 'local', command: cmd };
        const env = server['env'] as Record<string, string> | undefined;
        if (env) entry['environment'] = env;
        result[name] = entry;
      }
    }
  }

  return result;
}

/**
 * Ensures the opencode workspace directory exists with the right config files.
 * Writes opencode.json (MCP servers) and .opencode/agent/browserbird.md (system prompt).
 */
function ensureWorkspace(mcpConfigPath?: string, systemPrompt?: string): void {
  mkdirSync(resolve(WORKSPACE_DIR, '.opencode', 'agent'), { recursive: true });

  const config: Record<string, unknown> = {};

  if (mcpConfigPath) {
    try {
      const raw = readFileSync(resolve(mcpConfigPath), 'utf-8');
      const claudeConfig = JSON.parse(raw) as Record<string, unknown>;
      const mcp = translateMcpConfig(claudeConfig);
      if (Object.keys(mcp).length > 0) {
        config['mcp'] = mcp;
      }
    } catch (err) {
      logger.warn(
        `opencode: failed to read MCP config at ${mcpConfigPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  writeFileSync(resolve(WORKSPACE_DIR, 'opencode.json'), JSON.stringify(config, null, 2) + '\n');

  if (systemPrompt) {
    const agentMd = `---\nmode: primary\n---\n\n${systemPrompt}\n`;
    writeFileSync(resolve(WORKSPACE_DIR, '.opencode', 'agent', 'browserbird.md'), agentMd);
  }
}

/**
 * Builds the `opencode run` command for a given agent config.
 *
 * @remarks `fallbackModel` is not yet supported by opencode.
 * @see https://github.com/anomalyco/opencode/issues/7602
 */
function buildCommand(options: SpawnOptions): ProviderCommand {
  const { message, sessionId, agent, mcpConfigPath } = options;

  ensureWorkspace(mcpConfigPath, agent.systemPrompt);

  const args: string[] = ['run', '--format', 'json', '-m', agent.model];

  if (agent.systemPrompt) {
    args.push('--agent', 'browserbird');
  }

  if (sessionId) {
    args.push('--session', sessionId);
  }

  args.push(message);

  return { binary: 'opencode', args, cwd: WORKSPACE_DIR };
}

/**
 * Per-session accumulator for metrics that opencode spreads across multiple events.
 * Each `opencode run` is a separate process so there's no interleaving.
 * Reset on first step_start, consumed on final step_finish.
 */
let currentSessionId = '';
let startTimestamp = 0;
let stepCount = 0;
let totalTokensIn = 0;
let totalTokensOut = 0;
let totalCacheWrite = 0;
let totalCacheRead = 0;
let totalCost = 0;

function resetAccumulator(sessionId: string, timestamp: number): void {
  currentSessionId = sessionId;
  startTimestamp = timestamp;
  stepCount = 0;
  totalTokensIn = 0;
  totalTokensOut = 0;
  totalCacheWrite = 0;
  totalCacheRead = 0;
  totalCost = 0;
}

function accumulateStep(part: Record<string, unknown>, timestamp: number): void {
  stepCount++;
  const tokens = part['tokens'] as Record<string, unknown> | undefined;
  const cache = tokens?.['cache'] as Record<string, unknown> | undefined;
  totalTokensIn += (tokens?.['input'] as number) ?? 0;
  totalTokensOut += (tokens?.['output'] as number) ?? 0;
  totalCacheWrite += (cache?.['write'] as number) ?? 0;
  totalCacheRead += (cache?.['read'] as number) ?? 0;
  totalCost += (part['cost'] as number) ?? 0;
  // Use latest timestamp as end time (step_finish fires after step_start)
  startTimestamp = startTimestamp || timestamp;
}

/**
 * Parses a single line of opencode JSON output into zero or more StreamEvents.
 *
 * OpenCode emits these event types:
 *   step_start  → init (first one carries sessionID)
 *   text        → text_delta
 *   tool_use    → ignored (internal to the agent)
 *   step_finish → accumulates tokens/cost; final one (reason "stop") emits completion
 *   error       → error (connection/auth failures)
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
  const part = parsed['part'] as Record<string, unknown> | undefined;
  const timestamp = (parsed['timestamp'] as number) ?? 0;

  switch (eventType) {
    case 'step_start':
      if (part && typeof part['sessionID'] === 'string') {
        const sid = part['sessionID'];
        if (sid !== currentSessionId) resetAccumulator(sid, timestamp);
        return [
          {
            type: 'init',
            sessionId: sid,
            model: '',
          },
        ];
      }
      return [];

    case 'text':
      if (part && typeof part['text'] === 'string') {
        return [{ type: 'text_delta', delta: part['text'] }];
      }
      return [];

    case 'step_finish': {
      if (!part) return [];
      accumulateStep(part, timestamp);

      const reason = part['reason'] as string | undefined;
      if (reason !== 'stop') return [];

      const durationMs = timestamp > startTimestamp ? timestamp - startTimestamp : 0;
      const completion: StreamEvent = {
        type: 'completion',
        subtype: 'success',
        result: '',
        sessionId: (part['sessionID'] as string) ?? '',
        isError: false,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        cacheCreationTokens: totalCacheWrite,
        cacheReadTokens: totalCacheRead,
        costUsd: totalCost,
        durationMs,
        numTurns: stepCount,
      };

      resetAccumulator('', 0);
      return [completion];
    }

    case 'error': {
      const msg =
        typeof parsed['message'] === 'string' ? parsed['message'] : JSON.stringify(parsed);
      return [{ type: 'error', error: msg }];
    }

    default:
      return [];
  }
}

export const opencode: ProviderModule = { buildCommand, parseStreamLine };

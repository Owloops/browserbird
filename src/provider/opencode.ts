/** @fileoverview OpenCode CLI provider: arg building, workspace setup, and JSON stream parsing. */

import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
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

  const agentsMd = resolve('AGENTS.md');
  if (existsSync(agentsMd)) {
    copyFileSync(agentsMd, resolve(WORKSPACE_DIR, 'AGENTS.md'));
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

  const env: Record<string, string> = {};
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey) env['ANTHROPIC_API_KEY'] = apiKey;
  const openRouterKey = process.env['OPENROUTER_API_KEY'];
  if (openRouterKey) env['OPENROUTER_API_KEY'] = openRouterKey;
  const openAiKey = process.env['OPENAI_API_KEY'];
  if (openAiKey) env['OPENAI_API_KEY'] = openAiKey;
  const geminiKey = process.env['GEMINI_API_KEY'];
  if (geminiKey) env['GEMINI_API_KEY'] = geminiKey;

  return { binary: 'opencode', args, cwd: WORKSPACE_DIR, env };
}

interface MetricAccumulator {
  startTimestamp: number;
  stepCount: number;
  tokensIn: number;
  tokensOut: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
}

/** Per-session metric accumulators. Concurrent sessions each get their own entry. */
const accumulators = new Map<string, MetricAccumulator>();

function accumulateStep(sessionId: string, part: Record<string, unknown>): void {
  const acc = accumulators.get(sessionId)!;
  acc.stepCount++;
  const tokens = part['tokens'] as Record<string, unknown> | undefined;
  const cache = tokens?.['cache'] as Record<string, unknown> | undefined;
  acc.tokensIn += (tokens?.['input'] as number) ?? 0;
  acc.tokensOut += (tokens?.['output'] as number) ?? 0;
  acc.cacheWrite += (cache?.['write'] as number) ?? 0;
  acc.cacheRead += (cache?.['read'] as number) ?? 0;
  acc.cost += (part['cost'] as number) ?? 0;
}

/**
 * Parses a single line of opencode JSON output into zero or more StreamEvents.
 *
 * OpenCode emits these event types:
 *   step_start  -> init (first one carries sessionID)
 *   text        -> text_delta
 *   tool_use    -> ignored (internal to the agent)
 *   step_finish -> accumulates tokens/cost; final one (reason "stop") emits completion
 *   error       -> error (connection/auth failures)
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
        if (!accumulators.has(sid)) {
          accumulators.set(sid, {
            startTimestamp: timestamp,
            stepCount: 0,
            tokensIn: 0,
            tokensOut: 0,
            cacheWrite: 0,
            cacheRead: 0,
            cost: 0,
          });
        }
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
      const sid = (part['sessionID'] as string) ?? '';
      accumulateStep(sid, part);

      const reason = part['reason'] as string | undefined;
      if (reason !== 'stop') return [];

      const acc = accumulators.get(sid)!;

      const durationMs = timestamp > acc.startTimestamp ? timestamp - acc.startTimestamp : 0;
      const completion: StreamEvent = {
        type: 'completion',
        subtype: 'success',
        result: '',
        sessionId: sid,
        isError: false,
        tokensIn: acc.tokensIn,
        tokensOut: acc.tokensOut,
        cacheCreationTokens: acc.cacheWrite,
        cacheReadTokens: acc.cacheRead,
        costUsd: acc.cost,
        durationMs,
        numTurns: acc.stepCount,
      };

      accumulators.delete(sid);
      return [completion];
    }

    case 'error': {
      const err = parsed['error'] as Record<string, unknown> | undefined;
      const data = err?.['data'] as Record<string, unknown> | undefined;
      const msg =
        (typeof data?.['message'] === 'string' && data['message']) ||
        (typeof parsed['message'] === 'string' && parsed['message']) ||
        (typeof err?.['name'] === 'string' && err['name']) ||
        JSON.stringify(parsed);
      return [{ type: 'error', error: msg }];
    }

    default:
      return [];
  }
}

export const opencode: ProviderModule = { buildCommand, parseStreamLine };

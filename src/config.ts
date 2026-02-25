/** @fileoverview Configuration loading from JSON with env: variable resolution. */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './core/types.ts';
import { logger } from './core/logger.ts';

const VALID_PROVIDERS = new Set<string>(['claude', 'opencode']);
const VALID_BROWSER_MODES = new Set<string>(['persistent', 'isolated']);

const DEFAULTS: Config = {
  timezone: 'UTC',
  slack: {
    botToken: '',
    appToken: '',
    requireMention: true,
    coalesce: { debounceMs: 3000, bypassDms: true },
    channels: ['*'],
    quietHours: { enabled: false, start: '23:00', end: '08:00', timezone: 'UTC' },
  },
  agents: [
    {
      id: 'default',
      name: 'BrowserBird',
      provider: 'claude',
      model: 'sonnet',
      maxTurns: 50,
      systemPrompt: 'You are responding in a Slack workspace. Be concise, helpful, and natural.',
      channels: ['*'],
    },
  ],
  sessions: {
    ttlHours: 24,
    maxConcurrent: 5,
    processTimeoutMs: 300_000,
  },
  database: {
    retentionDays: 30,
  },
  browser: {
    enabled: false,
    mode: 'persistent',
    mcpConfigPath: undefined,
    vncPort: 5900,
    novncPort: 6080,
    novncHost: 'localhost',
  },
  birds: { maxAttempts: 3 },
  web: { enabled: true, host: '127.0.0.1', port: 18800, authToken: '', corsOrigin: '' },
};

/**
 * Resolves `"env:VAR_NAME"` strings to their environment variable values.
 * Throws if the env var is not set.
 */
function resolveEnvValue(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('env:')) {
    const envKey = value.slice(4);
    const envValue = process.env[envKey];
    if (envValue == null) {
      throw new Error(`Environment variable ${envKey} is not set (referenced as "${value}")`);
    }
    return envValue;
  }
  if (Array.isArray(value)) {
    return value.map(resolveEnvValue);
  }
  if (value !== null && typeof value === 'object') {
    return resolveEnvValues(value as Record<string, unknown>);
  }
  return value;
}

function resolveEnvValues(obj: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    resolved[key] = resolveEnvValue(value);
  }
  return resolved;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const targetValue = target[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Loads configuration from a JSON file, merges with defaults, and resolves env: references.
 * Searches for browserbird.json in the current directory, then falls back to defaults.
 */
export function loadConfig(configPath?: string): Config {
  const filePath = configPath ?? resolve('browserbird.json');

  if (!existsSync(filePath)) {
    logger.warn(`no config file found at ${filePath}, using defaults`);
    return DEFAULTS;
  }

  logger.info(`loading config from ${filePath}`);
  const raw = readFileSync(filePath, 'utf-8');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse config file: ${filePath}`);
  }

  const merged = deepMerge(DEFAULTS as unknown as Record<string, unknown>, parsed);
  const resolved = resolveEnvValues(merged);
  const config = resolved as unknown as Config;

  validateConfig(config);

  return config;
}

/** Validates merged config and throws on invalid values, warns on risky combinations. */
function validateConfig(config: Config): void {
  if (!Array.isArray(config.agents) || config.agents.length === 0) {
    throw new Error('at least one agent must be configured');
  }

  for (const agent of config.agents) {
    if (!agent.id || !agent.name) {
      throw new Error('each agent must have an "id" and "name"');
    }
    if (!VALID_PROVIDERS.has(agent.provider)) {
      throw new Error(
        `agent "${agent.id}": unknown provider "${agent.provider}" (expected: ${[...VALID_PROVIDERS].join(', ')})`,
      );
    }
    if (!agent.model) {
      throw new Error(`agent "${agent.id}": "model" is required`);
    }
    if (!Array.isArray(agent.channels) || agent.channels.length === 0) {
      throw new Error(`agent "${agent.id}": "channels" must be a non-empty array`);
    }
    if (agent.fallbackModel && agent.fallbackModel === agent.model) {
      throw new Error(
        `agent "${agent.id}": fallbackModel cannot be the same as model ("${agent.model}")`,
      );
    }
  }

  if (config.browser.enabled && !VALID_BROWSER_MODES.has(config.browser.mode)) {
    throw new Error(
      `browser.mode "${config.browser.mode}" is invalid (expected: ${[...VALID_BROWSER_MODES].join(', ')})`,
    );
  }

  if (
    config.browser.enabled &&
    config.browser.mode === 'persistent' &&
    config.sessions.maxConcurrent > 1
  ) {
    logger.warn(
      'persistent browser mode with maxConcurrent > 1 will cause lock contention; use "isolated" or set maxConcurrent to 1',
    );
  }
}

/** @fileoverview Configuration loading from JSON with env: variable resolution. */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Config } from './core/types.ts';
import { logger } from './core/logger.ts';

const DEFAULTS: Config = {
  slack: {
    botToken: '',
    appToken: '',
    coalesce: { debounceMs: 3000, bypassDms: true },
    permissions: { allowChannels: ['*'], denyChannels: [] },
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
    longResponseMode: 'snippet',
  },
  database: {
    retentionDays: 30,
    optimizeIntervalHours: 24,
  },
  browser: {
    enabled: false,
    mcpConfigPath: undefined,
    display: ':1',
    resolution: '1280x800x24',
    vncPort: 5900,
    novncPort: 6080,
  },
  cron: { maxFailures: 3 },
  web: { enabled: true, host: '127.0.0.1', port: 18800, authToken: '' },
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

  return resolved as unknown as Config;
}

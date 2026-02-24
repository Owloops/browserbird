/** @fileoverview Shared interfaces and type definitions for BrowserBird. */

import type { ProviderName } from '../provider/types.ts';

export interface SlackConfig {
  botToken: string;
  appToken: string;
  requireMention: boolean;
  coalesce: {
    debounceMs: number;
    bypassDms: boolean;
  };
  permissions: {
    allowChannels: string[];
    denyChannels: string[];
  };
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
}

export interface AgentConfig {
  id: string;
  name: string;
  provider: ProviderName;
  model: string;
  fallbackModel?: string;
  maxTurns: number;
  systemPrompt: string;
  channels: string[];
  processTimeoutMs?: number;
}

export interface SessionsConfig {
  ttlHours: number;
  maxConcurrent: number;
  processTimeoutMs: number;
}

export interface BrowserConfig {
  enabled: boolean;
  mcpConfigPath: string | undefined;
  display: string;
  resolution: string;
  vncPort: number;
  novncPort: number;
  novncHost: string;
}

export interface DatabaseConfig {
  retentionDays: number;
  optimizeIntervalHours: number;
}

export interface BirdsConfig {
  maxAttempts: number;
}

export interface WebConfig {
  enabled: boolean;
  host: string;
  port: number;
  authToken: string;
  corsOrigin: string;
}

export interface Config {
  slack: SlackConfig;
  agents: AgentConfig[];
  sessions: SessionsConfig;
  database: DatabaseConfig;
  browser: BrowserConfig;
  birds: BirdsConfig;
  web: WebConfig;
}

export const COMMANDS = {
  START: 'start',
  STOP: 'stop',
  STATUS: 'status',
  SESSIONS: 'sessions',
  BIRDS: 'birds',
  SETTINGS: 'settings',
  DATABASE: 'database',
  DOCTOR: 'doctor',
} as const;

export type Command = (typeof COMMANDS)[keyof typeof COMMANDS];

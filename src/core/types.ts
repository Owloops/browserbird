/** @fileoverview Shared interfaces and type definitions for BrowserBird. */

import type { ProviderName } from '../provider/types.ts';

export interface SlackConfig {
  botToken: string;
  appToken: string;
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
  longResponseMode: 'snippet' | 'thread';
}

export interface BrowserConfig {
  enabled: boolean;
  mcpConfigPath: string | undefined;
  display: string;
  resolution: string;
  vncPort: number;
  novncPort: number;
}

export interface DatabaseConfig {
  retentionDays: number;
  optimizeIntervalHours: number;
}

export interface CronConfig {
  enabled: boolean;
  maxFailures: number;
}

export interface WebConfig {
  enabled: boolean;
  host: string;
  port: number;
  authToken: string;
}

export interface Config {
  slack: SlackConfig;
  agents: AgentConfig[];
  sessions: SessionsConfig;
  database: DatabaseConfig;
  browser: BrowserConfig;
  cron: CronConfig;
  web: WebConfig;
}

export const COMMANDS = {
  START: 'start',
  STOP: 'stop',
  STATUS: 'status',
  LOGS: 'logs',
  SESSIONS: 'sessions',
  BIRDS: 'birds',
  AGENTS: 'agents',
  CONFIG: 'config',
  DB: 'db',
  JOBS: 'jobs',
  DOCTOR: 'doctor',
} as const;

export type Command = (typeof COMMANDS)[keyof typeof COMMANDS];

export interface CliOptions {
  command: Command | undefined;
  subcommand: string | undefined;
  args: string[];
  flags: {
    help: boolean;
    version: boolean;
    follow: boolean;
    verbose: boolean;
    channel?: string;
    agent?: string;
    schedule?: string;
    prompt?: string;
    days?: string;
    status?: string;
    allFailed: boolean;
    completed: boolean;
    failed: boolean;
    config?: string;
  };
}

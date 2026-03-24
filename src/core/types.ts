/** @fileoverview Shared interfaces and type definitions for BrowserBird. */

export interface SlackConfig {
  botToken: string;
  appToken: string;
  requireMention: boolean;
  coalesce: {
    debounceMs: number;
    bypassDms: boolean;
  };
  channels: string[];
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
}

export interface SuggestedPrompt {
  title: string;
  message: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  fallbackModel?: string;
  maxTurns: number;
  systemPrompt: string;
  channels: string[];
  processTimeoutMs?: number;
  suggestedPrompts?: SuggestedPrompt[];
}

export interface SessionsConfig {
  ttlHours: number;
  maxConcurrent: number;
  processTimeoutMs: number;
}

export interface BrowserConfig {
  enabled: boolean;
  mcpConfigPath: string | undefined;
  vncPort: number;
  novncPort: number;
  novncHost: string;
}

export interface BackupsConfig {
  maxCount: number;
  auto: boolean;
}

export interface DatabaseConfig {
  retentionDays: number;
  backups?: BackupsConfig;
}

export interface BirdsConfig {
  maxAttempts: number;
}

export interface WebConfig {
  enabled: boolean;
  host: string;
  port: number;
  corsOrigin: string;
}

export interface Config {
  timezone: string;
  slack: SlackConfig;
  agents: AgentConfig[];
  sessions: SessionsConfig;
  database: DatabaseConfig;
  browser: BrowserConfig;
  birds: BirdsConfig;
  web: WebConfig;
}

export const COMMANDS = {
  SESSIONS: 'sessions',
  BIRDS: 'birds',
  DOCS: 'docs',
  KEYS: 'keys',
  CONFIG: 'config',
  LOGS: 'logs',
  JOBS: 'jobs',
  BACKUPS: 'backups',
  DOCTOR: 'doctor',
} as const;

export type Command = (typeof COMMANDS)[keyof typeof COMMANDS];

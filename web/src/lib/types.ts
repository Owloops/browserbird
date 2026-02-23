/** @fileoverview Shared API response types for the web UI. */

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export interface StatusResponse {
  uptime: number;
  sessions: { active: number; maxConcurrent: number };
  jobs: JobStats;
  messages: { totalMessages: number; totalTokensIn: number; totalTokensOut: number };
  web: { enabled: boolean; port: number };
  browser: { enabled: boolean };
  slack: { connected: boolean };
}

export interface ConfigResponse {
  agents: {
    id: string;
    name: string;
    provider: string;
    model: string;
    maxTurns: number;
    channels: string[];
  }[];
  sessions: {
    ttlHours: number;
    maxConcurrent: number;
    processTimeoutMs: number;
    longResponseMode: string;
  };
  slack: {
    coalesce: { debounceMs: number; bypassDms: boolean };
    permissions: { allowChannels: string[]; denyChannels: string[] };
    quietHours: { enabled: boolean; start: string; end: string; timezone: string };
  };
  cron: { maxFailures: number };
  browser: {
    enabled: boolean;
    display: string;
    resolution: string;
    vncPort: number;
    novncPort: number;
  };
  database: { retentionDays: number; optimizeIntervalHours: number };
  web: { port: number; authEnabled: boolean };
}

export interface SessionRow {
  id: number;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  agent_id: string;
  provider_session_id: string;
  created_at: string;
  last_active: string;
  message_count: number;
}

export interface MessageRow {
  id: number;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  slack_user_id: string;
  direction: 'in' | 'out';
  content: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export interface SessionDetail {
  session: SessionRow;
  messages: PaginatedResult<MessageRow>;
  stats: { totalTokensIn: number; totalTokensOut: number };
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobRow {
  id: number;
  name: string;
  payload: string | null;
  status: JobStatus;
  priority: 'high' | 'normal' | 'low';
  attempts: number;
  max_attempts: number;
  timeout: number;
  cron_job_id: number | null;
  run_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
}

export interface JobStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

export interface CronJobRow {
  id: number;
  name: string;
  agent_id: string;
  schedule: string;
  prompt: string;
  target_channel_id: string | null;
  enabled: number;
  failure_count: number;
  last_run: string | null;
  last_status: string | null;
  created_at: string;
}

export interface CreateCronRequest {
  schedule: string;
  prompt: string;
  channel?: string;
  agent?: string;
}

export interface CleanupResponse {
  messages: number;
  cronRuns: number;
  jobs: number;
  logs: number;
}

export interface DoctorResponse {
  claude: { available: boolean; version: string | null };
  node: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRow {
  id: number;
  level: LogLevel;
  source: string;
  message: string;
  channel_id: string | null;
  created_at: string;
}

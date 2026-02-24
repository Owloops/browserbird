/** @fileoverview Shared API response types for the web UI. */

export interface ColumnDef {
  key: string;
  label: string;
  sortable?: boolean;
  class?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export interface FlightStats {
  running: number;
  completed: number;
  failed: number;
  total: number;
}

export interface StatusResponse {
  uptime: number;
  processes: { active: number; maxConcurrent: number };
  jobs: JobStats;
  flights: FlightStats;
  messages: { totalMessages: number; totalTokensIn: number; totalTokensOut: number };
  web: { enabled: boolean; port: number };
  agent: { available: boolean };
  browser: { enabled: boolean; connected: boolean };
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
  };
  slack: {
    requireMention: boolean;
    coalesce: { debounceMs: number; bypassDms: boolean };
    permissions: { allowChannels: string[]; denyChannels: string[] };
    quietHours: { enabled: boolean; start: string; end: string; timezone: string };
  };
  birds: { maxAttempts: number };
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
  channel_id: string;
  thread_id: string | null;
  agent_id: string;
  provider_session_id: string;
  created_at: string;
  last_active: string;
  message_count: number;
}

export interface MessageRow {
  id: number;
  channel_id: string;
  thread_id: string | null;
  user_id: string;
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

export interface FlightRow {
  id: number;
  job_id: number;
  cron_job_id: number;
  bird_name: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  result: string | null;
  error: string | null;
}

export interface InvalidateEvent {
  resource: 'sessions' | 'birds';
  cronJobId?: number;
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

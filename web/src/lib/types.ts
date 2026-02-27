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
  sessions: { total: number };
  web: { enabled: boolean; port: number };
  agent: { available: boolean };
  browser: { enabled: boolean; connected: boolean };
  slack: { connected: boolean };
}

export interface ConfigResponse {
  timezone: string;
  agents: {
    id: string;
    name: string;
    provider: string;
    model: string;
    fallbackModel: string | null;
    maxTurns: number;
    systemPrompt: string;
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
    channels: string[];
    quietHours: { enabled: boolean; start: string; end: string; timezone: string };
  };
  birds: { maxAttempts: number };
  browser: {
    enabled: boolean;
    mode: string;
    vncPort: number;
    novncPort: number;
  };
  database: { retentionDays: number };
  web: { port: number };
}

export interface SessionRow {
  uid: string;
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
  cron_job_uid: string | null;
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
  uid: string;
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

export interface UpcomingBird {
  uid: string;
  name: string;
  schedule: string;
  agent_id: string;
  next_run: string;
}

export interface CreateCronRequest {
  schedule: string;
  prompt: string;
  channel?: string;
  agent?: string;
}

export interface FlightRow {
  uid: string;
  job_uid: string;
  bird_uid: string;
  bird_name: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  result: string | null;
  error: string | null;
}

export interface InvalidateEvent {
  resource: 'sessions' | 'birds' | 'config' | 'secrets';
  cronJobUid?: string;
}

export interface SecretHint {
  set: boolean;
  hint: string;
}

export interface SecretsResponse {
  slack: {
    botToken: SecretHint;
    appToken: SecretHint;
  };
  anthropic: SecretHint;
}

export interface DoctorResponse {
  claude: { available: boolean; version: string | null };
  opencode: { available: boolean; version: string | null };
  node: string;
}

export interface OnboardingDefaults {
  agent: {
    name: string;
    provider: string;
    model: string;
    systemPrompt: string;
    maxTurns: number;
    channels: string[];
  };
  browser: {
    enabled: boolean;
  };
  doctor: DoctorResponse;
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

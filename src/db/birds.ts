/** @fileoverview Bird (cron job) and flight (cron run) persistence. */

import type { PaginatedResult } from './core.ts';
import {
  getDb,
  paginate,
  parseSort,
  buildSearchClause,
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
} from './core.ts';

export const SYSTEM_CRON_PREFIX = '__bb_';

export interface CronJobRow {
  id: number;
  name: string;
  agent_id: string;
  schedule: string;
  prompt: string;
  target_channel_id: string | null;
  active_hours_start: string | null;
  active_hours_end: string | null;
  timezone: string;
  enabled: number;
  failure_count: number;
  last_run: string | null;
  last_status: string | null;
  created_at: string;
}

export interface CronRunRow {
  id: number;
  job_id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  result: string | null;
  error: string | null;
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

export interface ListFlightsFilters {
  birdId?: number;
  status?: string;
  system?: boolean;
}

export interface UpdateCronJobFields {
  name?: string;
  schedule?: string;
  prompt?: string;
  targetChannelId?: string | null;
  agentId?: string;
  timezone?: string;
}

const CRON_SORT_COLUMNS = new Set([
  'id',
  'name',
  'schedule',
  'agent_id',
  'enabled',
  'last_run',
  'created_at',
]);
const CRON_SEARCH_COLUMNS = ['name', 'prompt', 'schedule'] as const;

export function listCronJobs(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  includeSystem = false,
  sort?: string,
  search?: string,
): PaginatedResult<CronJobRow> {
  const where = includeSystem ? '' : `name NOT LIKE '${SYSTEM_CRON_PREFIX}%'`;
  return paginate<CronJobRow>('cron_jobs', page, perPage, {
    where,
    defaultSort: 'id ASC',
    sort,
    search,
    allowedSortColumns: CRON_SORT_COLUMNS,
    searchColumns: CRON_SEARCH_COLUMNS,
  });
}

export function getEnabledCronJobs(): CronJobRow[] {
  return getDb()
    .prepare('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY id')
    .all() as unknown as CronJobRow[];
}

export function createCronJob(
  name: string,
  schedule: string,
  prompt: string,
  targetChannelId?: string,
  agentId?: string,
  timezone?: string,
): CronJobRow {
  const stmt = getDb().prepare(
    `INSERT INTO cron_jobs (name, schedule, prompt, target_channel_id, agent_id, timezone)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    name,
    schedule,
    prompt,
    targetChannelId ?? null,
    agentId ?? 'default',
    timezone ?? 'UTC',
  ) as unknown as CronJobRow;
}

export function updateCronJobStatus(jobId: number, status: string, failureCount: number): void {
  const stmt = getDb().prepare(
    `UPDATE cron_jobs SET last_run = datetime('now'), last_status = ?, failure_count = ? WHERE id = ?`,
  );
  stmt.run(status, failureCount, jobId);
}

export function getCronJob(jobId: number): CronJobRow | undefined {
  return getDb().prepare('SELECT * FROM cron_jobs WHERE id = ?').get(jobId) as unknown as
    | CronJobRow
    | undefined;
}

export function setCronJobEnabled(jobId: number, enabled: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE cron_jobs SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, jobId);
  return Number(result.changes) > 0;
}

export function updateCronJob(jobId: number, fields: UpdateCronJobFields): CronJobRow | undefined {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name);
  }
  if (fields.schedule !== undefined) {
    sets.push('schedule = ?');
    params.push(fields.schedule);
  }
  if (fields.prompt !== undefined) {
    sets.push('prompt = ?');
    params.push(fields.prompt);
  }
  if (fields.targetChannelId !== undefined) {
    sets.push('target_channel_id = ?');
    params.push(fields.targetChannelId);
  }
  if (fields.agentId !== undefined) {
    sets.push('agent_id = ?');
    params.push(fields.agentId);
  }
  if (fields.timezone !== undefined) {
    sets.push('timezone = ?');
    params.push(fields.timezone);
  }

  if (sets.length === 0) return getCronJob(jobId);

  params.push(jobId);
  return getDb()
    .prepare(`UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
    .get(...params) as unknown as CronJobRow | undefined;
}

export function deleteCronJob(jobId: number): boolean {
  const d = getDb();
  d.exec('BEGIN');
  try {
    d.prepare('DELETE FROM cron_runs WHERE job_id = ?').run(jobId);
    d.prepare('UPDATE jobs SET cron_job_id = NULL WHERE cron_job_id = ?').run(jobId);
    const result = d.prepare('DELETE FROM cron_jobs WHERE id = ?').run(jobId);
    d.exec('COMMIT');
    return Number(result.changes) > 0;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

const FLIGHT_SORT_COLUMNS = new Set(['id', 'started_at', 'finished_at', 'status', 'bird_name']);
const FLIGHT_SORT_MAP: Record<string, string> = { bird_name: 'j.name' };
const FLIGHT_SEARCH_COLUMNS = ['j.name', 'r.error', 'r.result'] as const;

export function listFlights(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  filters: ListFlightsFilters = {},
  sort?: string,
  search?: string,
): PaginatedResult<FlightRow> {
  const pp = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
  const p = Math.max(page, 1);
  const offset = (p - 1) * pp;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (!filters.system) {
    conditions.push(`j.name NOT LIKE '${SYSTEM_CRON_PREFIX}%'`);
  }
  if (filters.birdId != null) {
    conditions.push('r.job_id = ?');
    params.push(filters.birdId);
  }
  if (filters.status) {
    conditions.push('r.status = ?');
    params.push(filters.status);
  }

  if (search) {
    const sc = buildSearchClause(search, FLIGHT_SEARCH_COLUMNS);
    if (sc.sql) {
      conditions.push(sc.sql);
      params.push(...sc.params);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy = parseSort(sort, FLIGHT_SORT_COLUMNS, 'id DESC');
  for (const [key, qualified] of Object.entries(FLIGHT_SORT_MAP)) {
    orderBy = orderBy.replaceAll(key, qualified);
  }
  orderBy = orderBy.replace(/\b(id|started_at|finished_at|status)\b/g, 'r.$1');

  const countRow = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM cron_runs r JOIN cron_jobs j ON j.id = r.job_id ${where}`,
    )
    .get(...params) as unknown as { count: number };
  const totalItems = countRow.count;
  const totalPages = Math.max(Math.ceil(totalItems / pp), 1);

  const items = getDb()
    .prepare(
      `SELECT r.id, r.job_id, j.id as cron_job_id, j.name as bird_name,
              r.started_at, r.finished_at, r.status, r.result, r.error
       FROM cron_runs r
       JOIN cron_jobs j ON j.id = r.job_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pp, offset) as unknown as FlightRow[];

  return { items, page: p, perPage: pp, totalItems, totalPages };
}

export function createCronRun(jobId: number): CronRunRow {
  const stmt = getDb().prepare('INSERT INTO cron_runs (job_id) VALUES (?) RETURNING *');
  return stmt.get(jobId) as unknown as CronRunRow;
}

export function completeCronRun(
  runId: number,
  status: 'success' | 'error',
  result?: string,
  error?: string,
): void {
  const stmt = getDb().prepare(
    `UPDATE cron_runs SET finished_at = datetime('now'), status = ?, result = ?, error = ? WHERE id = ?`,
  );
  stmt.run(status, result ?? null, error ?? null, runId);
}

export interface FlightStats {
  running: number;
  completed: number;
  failed: number;
  total: number;
}

export function getFlightStats(): FlightStats {
  const rows = getDb()
    .prepare(
      `SELECT r.status, COUNT(*) as count
       FROM cron_runs r
       JOIN cron_jobs j ON j.id = r.job_id
       WHERE j.name NOT LIKE '${SYSTEM_CRON_PREFIX}%'
       GROUP BY r.status`,
    )
    .all() as unknown as Array<{ status: string; count: number }>;

  const stats: FlightStats = { running: 0, completed: 0, failed: 0, total: 0 };
  for (const row of rows) {
    if (row.status === 'running') stats.running = row.count;
    else if (row.status === 'success') stats.completed = row.count;
    else if (row.status === 'error') stats.failed = row.count;
    stats.total += row.count;
  }
  return stats;
}

export function deleteOldCronRuns(retentionDays: number): number {
  const stmt = getDb().prepare(
    `DELETE FROM cron_runs WHERE started_at < datetime('now', ? || ' days')`,
  );
  const result = stmt.run(`-${retentionDays}`);
  return Number(result.changes);
}

export function ensureSystemCronJob(name: string, schedule: string, prompt: string): void {
  const existing = getDb().prepare('SELECT id FROM cron_jobs WHERE name = ?').get(name) as
    | unknown
    | undefined;
  if (existing) return;
  getDb()
    .prepare(`INSERT INTO cron_jobs (name, schedule, prompt, agent_id) VALUES (?, ?, ?, 'system')`)
    .run(name, schedule, prompt);
}

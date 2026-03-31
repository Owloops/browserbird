/** @fileoverview Bird (cron job) and flight (cron run) persistence. */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PaginatedResult } from './core.ts';
import {
  getDb,
  paginate,
  parseSort,
  buildSearchClause,
  DEFAULT_PER_PAGE,
  MAX_PER_PAGE,
} from './core.ts';
import { generateUid, UID_PREFIX } from '../core/uid.ts';

const BIRDS_DIR = resolve('.browserbird', 'birds');

function getBirdDataDir(birdUid: string): string {
  return resolve(BIRDS_DIR, birdUid, 'data');
}

export function ensureBirdDataDir(birdUid: string): string {
  const dir = getBirdDataDir(birdUid);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const SYSTEM_CRON_PREFIX = '__bb_';

export interface CronJobRow {
  uid: string;
  name: string;
  agent_id: string;
  schedule: string;
  prompt: string;
  target_channel_id: string | null;
  active_hours_start: string | null;
  active_hours_end: string | null;
  enabled: number;
  failure_count: number;
  last_run: string | null;
  last_status: string | null;
  created_at: string;
}

export interface CronRunRow {
  uid: string;
  job_uid: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  result: string | null;
  error: string | null;
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

export interface ListFlightsFilters {
  birdUid?: string;
  status?: string;
  system?: boolean;
}

export interface UpdateCronJobFields {
  name?: string;
  schedule?: string;
  prompt?: string;
  targetChannelId?: string | null;
  agentId?: string;
  activeHoursStart?: string | null;
  activeHoursEnd?: string | null;
}

const CRON_SORT_COLUMNS = new Set([
  'uid',
  'name',
  'schedule',
  'agent_id',
  'enabled',
  'last_run',
  'created_at',
]);
const CRON_SEARCH_COLUMNS = ['uid', 'name', 'prompt', 'schedule'] as const;

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
    defaultSort: 'created_at ASC',
    sort,
    search,
    allowedSortColumns: CRON_SORT_COLUMNS,
    searchColumns: CRON_SEARCH_COLUMNS,
  });
}

export function getEnabledCronJobs(): CronJobRow[] {
  return getDb()
    .prepare('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY created_at')
    .all() as unknown as CronJobRow[];
}

export function createCronJob(
  name: string,
  schedule: string,
  prompt: string,
  targetChannelId?: string,
  agentId?: string,
  activeHoursStart?: string,
  activeHoursEnd?: string,
): CronJobRow {
  const uid = generateUid(UID_PREFIX.bird);
  const stmt = getDb().prepare(
    `INSERT INTO cron_jobs (uid, name, schedule, prompt, target_channel_id, agent_id, active_hours_start, active_hours_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  const row = stmt.get(
    uid,
    name,
    schedule,
    prompt,
    targetChannelId ?? null,
    agentId ?? 'default',
    activeHoursStart ?? null,
    activeHoursEnd ?? null,
  ) as unknown as CronJobRow;
  return row;
}

export function updateCronJobStatus(
  jobUid: string,
  status: string,
  failureCount: number,
  enabled?: boolean,
): void {
  if (enabled != null) {
    getDb()
      .prepare(
        `UPDATE cron_jobs SET last_run = datetime('now'), last_status = ?, failure_count = ?, enabled = ? WHERE uid = ?`,
      )
      .run(status, failureCount, enabled ? 1 : 0, jobUid);
  } else {
    getDb()
      .prepare(
        `UPDATE cron_jobs SET last_run = datetime('now'), last_status = ?, failure_count = ? WHERE uid = ?`,
      )
      .run(status, failureCount, jobUid);
  }
}

export function getCronJob(jobUid: string): CronJobRow | undefined {
  return getDb().prepare('SELECT * FROM cron_jobs WHERE uid = ?').get(jobUid) as unknown as
    | CronJobRow
    | undefined;
}

export function setCronJobEnabled(jobUid: string, enabled: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE cron_jobs SET enabled = ? WHERE uid = ?')
    .run(enabled ? 1 : 0, jobUid);
  return Number(result.changes) > 0;
}

export function updateCronJob(jobUid: string, fields: UpdateCronJobFields): CronJobRow | undefined {
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
  if (fields.activeHoursStart !== undefined) {
    sets.push('active_hours_start = ?');
    params.push(fields.activeHoursStart);
  }
  if (fields.activeHoursEnd !== undefined) {
    sets.push('active_hours_end = ?');
    params.push(fields.activeHoursEnd);
  }

  if (sets.length === 0) return getCronJob(jobUid);

  params.push(jobUid);
  return getDb()
    .prepare(`UPDATE cron_jobs SET ${sets.join(', ')} WHERE uid = ? RETURNING *`)
    .get(...params) as unknown as CronJobRow | undefined;
}

export function deleteCronJob(jobUid: string): boolean {
  const d = getDb();
  d.exec('BEGIN');
  let deleted: boolean;
  try {
    d.prepare('DELETE FROM cron_runs WHERE job_uid = ?').run(jobUid);
    d.prepare('UPDATE jobs SET cron_job_uid = NULL WHERE cron_job_uid = ?').run(jobUid);
    d.prepare("DELETE FROM key_bindings WHERE target_type = 'bird' AND target_id = ?").run(jobUid);
    const result = d.prepare('DELETE FROM cron_jobs WHERE uid = ?').run(jobUid);
    d.exec('COMMIT');
    deleted = Number(result.changes) > 0;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
  rmSync(resolve(BIRDS_DIR, jobUid), { recursive: true, force: true });
  return deleted;
}

const FLIGHT_SORT_COLUMNS = new Set(['uid', 'started_at', 'finished_at', 'status', 'bird_name']);
const FLIGHT_SORT_MAP: Record<string, string> = { bird_name: 'j.name' };
const FLIGHT_SEARCH_COLUMNS = [
  'r.uid',
  'r.job_uid',
  'j.uid',
  'j.name',
  'r.error',
  'r.result',
] as const;

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
  if (filters.birdUid != null) {
    conditions.push('r.job_uid = ?');
    params.push(filters.birdUid);
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

  let orderBy = parseSort(sort, FLIGHT_SORT_COLUMNS, 'r.started_at DESC');
  for (const [key, qualified] of Object.entries(FLIGHT_SORT_MAP)) {
    orderBy = orderBy.replaceAll(key, qualified);
  }
  orderBy = orderBy.replace(/(?<![a-z.])\b(uid|started_at|finished_at|status)\b/g, 'r.$1');

  const countRow = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM cron_runs r JOIN cron_jobs j ON j.uid = r.job_uid ${where}`,
    )
    .get(...params) as unknown as { count: number };
  const totalItems = countRow.count;
  const totalPages = Math.max(Math.ceil(totalItems / pp), 1);

  const items = getDb()
    .prepare(
      `SELECT r.uid, r.job_uid, j.uid as bird_uid, j.name as bird_name,
              r.started_at, r.finished_at, r.status, r.result, r.error
       FROM cron_runs r
       JOIN cron_jobs j ON j.uid = r.job_uid
       ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pp, offset) as unknown as FlightRow[];

  return { items, page: p, perPage: pp, totalItems, totalPages };
}

export function createCronRun(jobUid: string): CronRunRow {
  const uid = generateUid(UID_PREFIX.flight);
  const stmt = getDb().prepare('INSERT INTO cron_runs (uid, job_uid) VALUES (?, ?) RETURNING *');
  return stmt.get(uid, jobUid) as unknown as CronRunRow;
}

export function completeCronRun(
  runUid: string,
  status: 'success' | 'error',
  result?: string,
  error?: string,
): void {
  const stmt = getDb().prepare(
    `UPDATE cron_runs SET finished_at = datetime('now'), status = ?, result = ?, error = ? WHERE uid = ?`,
  );
  stmt.run(status, result ?? null, error ?? null, runUid);
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
       JOIN cron_jobs j ON j.uid = r.job_uid
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
  const existing = getDb().prepare('SELECT uid FROM cron_jobs WHERE name = ?').get(name) as
    | unknown
    | undefined;
  if (existing) return;
  const uid = generateUid(UID_PREFIX.bird);
  getDb()
    .prepare(
      `INSERT INTO cron_jobs (uid, name, schedule, prompt, agent_id) VALUES (?, ?, ?, ?, 'system')`,
    )
    .run(uid, name, schedule, prompt);
}

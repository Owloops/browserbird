/** @fileoverview Tests for the jobs route handlers (retry, retry-failed, delete, clear). */

import { describe, it, before, after, beforeEach } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Route } from '../http.ts';
import { openDatabase, closeDatabase, getDb, createJob } from '../../db/index.ts';
import type { JobRow } from '../../db/index.ts';
import { buildJobsRoutes } from './jobs.ts';

interface CapturedRes {
  status: number;
  headers: Record<string, unknown>;
  body: string;
  headersSent: boolean;
}

function makeReq(opts: { url: string; method?: string; body?: unknown }): IncomingMessage {
  const chunks = opts.body !== undefined ? [Buffer.from(JSON.stringify(opts.body), 'utf-8')] : [];
  const stream = Readable.from(chunks) as unknown as IncomingMessage;
  stream.url = opts.url;
  stream.method = opts.method ?? 'GET';
  stream.headers = { host: 'localhost' };
  return stream;
}

function makeRes(): { res: ServerResponse; captured: CapturedRes } {
  const captured: CapturedRes = { status: 0, headers: {}, body: '', headersSent: false };
  const res = {
    writeHead(status: number, headers?: Record<string, unknown>) {
      captured.status = status;
      if (headers) captured.headers = headers;
      captured.headersSent = true;
    },
    end(body?: string) {
      if (typeof body === 'string') captured.body = body;
    },
    get headersSent() {
      return captured.headersSent;
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

async function invoke(
  routes: Route[],
  method: string,
  path: string,
  body?: unknown,
): Promise<CapturedRes> {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.pattern);
    if (!match) continue;
    const params = (match.groups ?? {}) as Record<string, string>;
    const req = makeReq({ url: path, method, body });
    const { res, captured } = makeRes();
    await route.handler(req, res, params);
    return captured;
  }
  throw new Error(`no route matched ${method} ${path}`);
}

function parseBody<T>(captured: CapturedRes): T {
  return JSON.parse(captured.body) as T;
}

function setJobStatus(id: number, status: 'completed' | 'failed' | 'pending'): void {
  getDb()
    .prepare(
      `UPDATE jobs SET status = ?, completed_at = ${status === 'pending' ? 'NULL' : "datetime('now')"} WHERE id = ?`,
    )
    .run(status, id);
}

function seedJob(status: 'pending' | 'failed' | 'completed' = 'pending'): JobRow {
  const job = createJob({ name: 'test_job', payload: { x: 1 } });
  if (status !== 'pending') setJobStatus(job.id, status);
  return job;
}

describe('jobs routes', () => {
  let tmpRoot: string;
  let routes: Route[];

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bb-jobs-route-test-'));
    openDatabase(join(tmpRoot, 'test.db'));
    routes = buildJobsRoutes();
  });

  after(() => {
    closeDatabase();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM jobs');
  });

  describe('POST /api/jobs/:id/retry', () => {
    it('moves a failed job back to pending', async () => {
      const job = seedJob('failed');
      const captured = await invoke(routes, 'POST', `/api/jobs/${job.id}/retry`);
      strictEqual(captured.status, 200);
      const refreshed = getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(job.id) as {
        status: string;
      };
      strictEqual(refreshed.status, 'pending');
    });

    it('returns 404 for a non-failed job', async () => {
      const job = seedJob('completed');
      const captured = await invoke(routes, 'POST', `/api/jobs/${job.id}/retry`);
      strictEqual(captured.status, 404);
    });

    it('returns 404 for a non-existent job', async () => {
      const captured = await invoke(routes, 'POST', '/api/jobs/99999/retry');
      strictEqual(captured.status, 404);
    });

    it('returns 400 for non-numeric id', async () => {
      const captured = await invoke(routes, 'POST', '/api/jobs/abc/retry');
      strictEqual(captured.status, 400);
    });
  });

  describe('POST /api/jobs/retry-failed', () => {
    it('resets all failed jobs and returns the count', async () => {
      seedJob('failed');
      seedJob('failed');
      seedJob('completed');
      const captured = await invoke(routes, 'POST', '/api/jobs/retry-failed');
      strictEqual(captured.status, 200);
      const body = parseBody<{ count: number }>(captured);
      strictEqual(body.count, 2);
      const remainingFailed = getDb()
        .prepare("SELECT COUNT(*) as c FROM jobs WHERE status = 'failed'")
        .get() as { c: number };
      strictEqual(remainingFailed.c, 0);
    });

    it('returns 0 when no failed jobs exist', async () => {
      seedJob('completed');
      const captured = await invoke(routes, 'POST', '/api/jobs/retry-failed');
      const body = parseBody<{ count: number }>(captured);
      strictEqual(body.count, 0);
    });
  });

  describe('DELETE /api/jobs/:id', () => {
    it('deletes the row and returns success', async () => {
      const job = seedJob('completed');
      const captured = await invoke(routes, 'DELETE', `/api/jobs/${job.id}`);
      strictEqual(captured.status, 200);
      const after = getDb().prepare('SELECT id FROM jobs WHERE id = ?').get(job.id);
      strictEqual(after, undefined);
    });

    it('returns 404 when the id does not exist', async () => {
      const captured = await invoke(routes, 'DELETE', '/api/jobs/99999');
      strictEqual(captured.status, 404);
    });

    it('returns 400 for non-numeric id', async () => {
      const captured = await invoke(routes, 'DELETE', '/api/jobs/garbage');
      strictEqual(captured.status, 400);
    });
  });

  describe('POST /api/jobs/clear', () => {
    it('clears jobs matching the provided status list', async () => {
      seedJob('completed');
      seedJob('completed');
      seedJob('failed');
      seedJob('pending');
      const captured = await invoke(routes, 'POST', '/api/jobs/clear', {
        statuses: ['completed'],
      });
      strictEqual(captured.status, 200);
      const body = parseBody<{ count: number }>(captured);
      strictEqual(body.count, 2);
      const remaining = getDb().prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number };
      strictEqual(remaining.c, 2);
    });

    it('clears multiple statuses in one call', async () => {
      seedJob('completed');
      seedJob('failed');
      seedJob('pending');
      const captured = await invoke(routes, 'POST', '/api/jobs/clear', {
        statuses: ['completed', 'failed'],
      });
      const body = parseBody<{ count: number }>(captured);
      strictEqual(body.count, 2);
      const pendingRow = getDb()
        .prepare("SELECT COUNT(*) as c FROM jobs WHERE status = 'pending'")
        .get() as { c: number };
      strictEqual(pendingRow.c, 1);
    });

    it('rejects an empty statuses array with 400', async () => {
      const captured = await invoke(routes, 'POST', '/api/jobs/clear', { statuses: [] });
      strictEqual(captured.status, 400);
      ok(captured.body.includes('non-empty'));
    });

    it('rejects a non-clearable status with 400', async () => {
      const captured = await invoke(routes, 'POST', '/api/jobs/clear', { statuses: ['pending'] });
      strictEqual(captured.status, 400);
      ok(captured.body.includes('Cannot clear'));
    });

    it('rejects invalid JSON body with 400', async () => {
      const req = makeReq({ url: '/api/jobs/clear', method: 'POST' });
      req.push('{not json');
      req.push(null);
      const { res, captured } = makeRes();
      const route = routes.find((r) => r.method === 'POST' && '/api/jobs/clear'.match(r.pattern));
      if (!route) throw new Error('route not found');
      await route.handler(req, res, {});
      strictEqual(captured.status, 400);
    });
  });
});

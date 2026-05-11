/** @fileoverview Jobs API route handlers. */

import type { Route } from '../http.ts';
import { pathToRegex, json, jsonError, readJsonBody } from '../http.ts';
import { broadcastSSE } from '../sse.ts';
import { retryJob, retryAllFailedJobs, deleteJob, clearJobs } from '../../db/index.ts';

type ClearableStatus = 'completed' | 'failed';

const CLEARABLE_STATUSES: ReadonlySet<ClearableStatus> = new Set(['completed', 'failed']);

export function buildJobsRoutes(): Route[] {
  return [
    {
      method: 'POST',
      pattern: pathToRegex('/api/jobs/retry-failed'),
      handler(_req, res) {
        const count = retryAllFailedJobs();
        broadcastSSE('invalidate', { resource: 'jobs' });
        json(res, { count });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/jobs/:id/retry'),
      handler(_req, res, params) {
        const idStr = params['id'];
        const id = Number(idStr);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid job id', 400);
          return;
        }
        if (!retryJob(id)) {
          jsonError(res, `Job ${id} not found or not in failed state`, 404);
          return;
        }
        broadcastSSE('invalidate', { resource: 'jobs' });
        json(res, { success: true });
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/jobs/:id'),
      handler(_req, res, params) {
        const idStr = params['id'];
        const id = Number(idStr);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid job id', 400);
          return;
        }
        if (!deleteJob(id)) {
          jsonError(res, `Job ${id} not found`, 404);
          return;
        }
        broadcastSSE('invalidate', { resource: 'jobs' });
        json(res, { success: true });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/jobs/clear'),
      async handler(req, res) {
        let body: { statuses?: string[] };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!Array.isArray(body.statuses) || body.statuses.length === 0) {
          jsonError(res, '"statuses" must be a non-empty array', 400);
          return;
        }
        for (const s of body.statuses) {
          if (!CLEARABLE_STATUSES.has(s as ClearableStatus)) {
            jsonError(res, `Cannot clear status "${s}"; allowed: completed, failed`, 400);
            return;
          }
        }
        let total = 0;
        for (const s of body.statuses) {
          total += clearJobs(s as ClearableStatus);
        }
        broadcastSSE('invalidate', { resource: 'jobs' });
        json(res, { count: total });
      },
    },
  ];
}

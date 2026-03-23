/** @fileoverview Sessions, jobs, messages, and logs API route handlers. */

import type { Config } from '../../core/types.ts';
import type { Route, WebServerDeps } from '../http.ts';
import {
  pathToRegex,
  json,
  jsonError,
  parsePagination,
  parseSortParam,
  parseSearchParam,
} from '../http.ts';
import {
  listSessions,
  getSession,
  findSession,
  getSessionMessages,
  getSessionTokenStats,
  getSessionCount,
  listJobs,
  getJobStats,
  getMessageStats,
  getFlightStats,
  getRecentLogs,
  retryJob,
  retryAllFailedJobs,
  deleteJob,
  clearJobs,
} from '../../db/index.ts';

export function buildStatusPayload(
  getConfig: () => Config,
  startedAt: number,
  getDeps: () => WebServerDeps,
): object {
  const config = getConfig();
  const deps = getDeps();
  const jobs = getJobStats();
  const flights = getFlightStats();
  const messages = getMessageStats();
  const health = deps.serviceHealth();
  return {
    uptime: Date.now() - startedAt,
    processes: {
      active: deps.activeProcessCount(),
      maxConcurrent: config.sessions.maxConcurrent,
    },
    jobs,
    flights,
    messages,
    sessions: { total: getSessionCount() },
    web: { enabled: config.web.enabled, port: config.web.port },
    agent: health.agent,
    browser: { enabled: config.browser.enabled, connected: health.browser.connected },
    slack: { connected: deps.slackConnected() },
  };
}

export interface DataRouteDeps {
  getConfig: () => Config;
  startedAt: number;
  getDeps: () => WebServerDeps;
}

export function buildDataRoutes(deps: DataRouteDeps): Route[] {
  const { getConfig, startedAt, getDeps } = deps;

  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/healthcheck'),
      skipAuth: true,
      handler(_req, res) {
        json(res, { ok: true });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/status'),
      handler(_req, res) {
        json(res, buildStatusPayload(getConfig, startedAt, getDeps));
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/sessions'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        json(res, listSessions(page, perPage, parseSortParam(url), parseSearchParam(url)));
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/sessions/:id'),
      handler(req, res, params) {
        const uid = params['id'];
        if (!uid) {
          jsonError(res, 'Missing session ID', 400);
          return;
        }
        let session = getSession(uid);
        if (!session) {
          session = findSession('web', uid);
        }
        if (!session) {
          jsonError(res, `Session ${uid} not found`, 404);
          return;
        }
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        const messages = getSessionMessages(
          session.channel_id,
          session.thread_id,
          page,
          perPage,
          parseSortParam(url),
          parseSearchParam(url),
        );
        const stats = getSessionTokenStats(session.channel_id, session.thread_id);
        json(res, { session, messages, stats });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/jobs/stats'),
      handler(_req, res) {
        json(res, getJobStats());
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/jobs/retry-all'),
      handler(_req, res) {
        const count = retryAllFailedJobs();
        json(res, { count });
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/jobs/clear'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const status = url.searchParams.get('status');
        if (status !== 'completed' && status !== 'failed') {
          jsonError(res, 'Query param "status" must be "completed" or "failed"', 400);
          return;
        }
        const count = clearJobs(status);
        json(res, { count });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/jobs'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        const status = url.searchParams.get('status') ?? undefined;
        const cronJobUid = url.searchParams.get('cronJobUid') ?? undefined;
        const name = url.searchParams.get('name') ?? undefined;
        json(
          res,
          listJobs(
            page,
            perPage,
            { status, cronJobUid, name },
            parseSortParam(url),
            parseSearchParam(url),
          ),
        );
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/jobs/:id/retry'),
      handler(_req, res, params) {
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid job ID', 400);
          return;
        }
        if (retryJob(id)) {
          json(res, { success: true });
        } else {
          jsonError(res, `Job #${id} not found or not in failed state`, 404);
        }
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/jobs/:id'),
      handler(_req, res, params) {
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid job ID', 400);
          return;
        }
        if (deleteJob(id)) {
          json(res, { success: true });
        } else {
          jsonError(res, `Job #${id} not found`, 404);
        }
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/messages/stats'),
      handler(_req, res) {
        json(res, getMessageStats());
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/logs'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        const level = url.searchParams.get('level') ?? undefined;
        const source = url.searchParams.get('source') ?? undefined;
        json(
          res,
          getRecentLogs(page, perPage, level, source, parseSortParam(url), parseSearchParam(url)),
        );
      },
    },
  ];
}

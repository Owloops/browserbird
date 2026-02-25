/** @fileoverview API route definitions. */

import type { Config, AgentConfig } from '../core/types.ts';
import type { Route, WebServerDeps } from './http.ts';
import {
  pathToRegex,
  json,
  jsonError,
  parsePagination,
  parseSystemFlag,
  parseSortParam,
  parseSearchParam,
  readJsonBody,
} from './http.ts';
import { broadcastSSE } from './sse.ts';
import {
  SYSTEM_CRON_PREFIX,
  listSessions,
  getSession,
  getSessionMessages,
  getSessionTokenStats,
  listJobs,
  getJobStats,
  listCronJobs,
  listFlights,
  getMessageStats,
  getFlightStats,
  getRecentLogs,
  retryJob,
  retryAllFailedJobs,
  deleteJob,
  clearJobs,
  setCronJobEnabled,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  getCronJob,
} from '../db/index.ts';
import { enqueue } from '../jobs.ts';
import { getErrorRates } from '../core/metrics.ts';
import { checkDoctor } from '../cli/index.ts';

export function buildRoutes(config: Config, startedAt: number, deps: WebServerDeps): Route[] {
  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/auth/check'),
      skipAuth: true,
      handler(_req, res) {
        json(res, { authRequired: !!config.web.authToken });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/auth/verify'),
      handler(_req, res) {
        json(res, { valid: true });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/doctor'),
      handler(_req, res) {
        json(res, checkDoctor());
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/status'),
      handler(_req, res) {
        const uptimeMs = Date.now() - startedAt;
        const jobs = getJobStats();
        const flights = getFlightStats();
        const messages = getMessageStats();
        const health = deps.serviceHealth();
        json(res, {
          uptime: uptimeMs,
          processes: {
            active: deps.activeProcessCount(),
            maxConcurrent: config.sessions.maxConcurrent,
          },
          jobs,
          flights,
          messages,
          web: { enabled: config.web.enabled, port: config.web.port },
          agent: health.agent,
          browser: { enabled: config.browser.enabled, connected: health.browser.connected },
          slack: { connected: deps.slackConnected() },
        });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/config'),
      handler(_req, res) {
        json(res, {
          timezone: config.timezone,
          agents: config.agents.map((a: AgentConfig) => ({
            id: a.id,
            name: a.name,
            provider: a.provider,
            model: a.model,
            maxTurns: a.maxTurns,
            channels: a.channels,
          })),
          sessions: {
            ttlHours: config.sessions.ttlHours,
            maxConcurrent: config.sessions.maxConcurrent,
            processTimeoutMs: config.sessions.processTimeoutMs,
          },
          slack: {
            requireMention: config.slack.requireMention,
            coalesce: config.slack.coalesce,
            permissions: config.slack.permissions,
            quietHours: config.slack.quietHours,
          },
          birds: config.birds,
          browser: config.browser,
          database: config.database,
          web: { port: config.web.port, authEnabled: !!config.web.authToken },
        });
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
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid session ID', 400);
          return;
        }
        const session = getSession(id);
        if (!session) {
          jsonError(res, `Session #${id} not found`, 404);
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
        const cronJobIdParam = url.searchParams.get('cronJobId');
        const cronJobId = cronJobIdParam ? Number(cronJobIdParam) : undefined;
        const name = url.searchParams.get('name') ?? undefined;
        json(
          res,
          listJobs(
            page,
            perPage,
            { status, cronJobId, name },
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
      pattern: pathToRegex('/api/birds'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        json(
          res,
          listCronJobs(
            page,
            perPage,
            parseSystemFlag(url),
            parseSortParam(url),
            parseSearchParam(url),
          ),
        );
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/birds/:id/enable'),
      handler(_req, res, params) {
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid bird ID', 400);
          return;
        }
        if (setCronJobEnabled(id, true)) {
          broadcastSSE('invalidate', { resource: 'birds' });
          json(res, { success: true });
        } else {
          jsonError(res, `Bird #${id} not found`, 404);
        }
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/birds/:id/disable'),
      handler(_req, res, params) {
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid bird ID', 400);
          return;
        }
        if (setCronJobEnabled(id, false)) {
          broadcastSSE('invalidate', { resource: 'birds' });
          json(res, { success: true });
        } else {
          jsonError(res, `Bird #${id} not found`, 404);
        }
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/birds'),
      async handler(req, res) {
        let body: {
          schedule?: string;
          prompt?: string;
          channel?: string;
          agent?: string;
          timezone?: string;
          activeHoursStart?: string;
          activeHoursEnd?: string;
        };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.schedule || typeof body.schedule !== 'string' || !body.schedule.trim()) {
          jsonError(res, '"schedule" is required', 400);
          return;
        }
        if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
          jsonError(res, '"prompt" is required', 400);
          return;
        }
        const name = body.prompt.slice(0, 50);
        const job = createCronJob(
          name,
          body.schedule.trim(),
          body.prompt.trim(),
          body.channel?.trim() || undefined,
          body.agent?.trim() || undefined,
          body.timezone?.trim() || config.timezone,
          body.activeHoursStart?.trim() || undefined,
          body.activeHoursEnd?.trim() || undefined,
        );
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, job, 201);
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/birds/:id'),
      async handler(req, res, params) {
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid bird ID', 400);
          return;
        }
        let body: {
          schedule?: string;
          prompt?: string;
          channel?: string | null;
          agent?: string;
          timezone?: string;
          activeHoursStart?: string | null;
          activeHoursEnd?: string | null;
        };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        const updated = updateCronJob(id, {
          schedule: body.schedule?.trim() || undefined,
          prompt: body.prompt?.trim() || undefined,
          name: body.prompt ? body.prompt.trim().slice(0, 50) : undefined,
          targetChannelId: body.channel !== undefined ? body.channel?.trim() || null : undefined,
          agentId: body.agent?.trim() || undefined,
          timezone: body.timezone?.trim() || undefined,
          activeHoursStart:
            body.activeHoursStart !== undefined ? body.activeHoursStart?.trim() || null : undefined,
          activeHoursEnd:
            body.activeHoursEnd !== undefined ? body.activeHoursEnd?.trim() || null : undefined,
        });
        if (updated) {
          broadcastSSE('invalidate', { resource: 'birds' });
          json(res, updated);
        } else {
          jsonError(res, `Bird #${id} not found`, 404);
        }
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/birds/:id'),
      handler(_req, res, params) {
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid bird ID', 400);
          return;
        }
        const cronJob = getCronJob(id);
        if (!cronJob) {
          jsonError(res, `Bird #${id} not found`, 404);
          return;
        }
        if (cronJob.name.startsWith(SYSTEM_CRON_PREFIX)) {
          jsonError(res, 'System birds cannot be deleted', 403);
          return;
        }
        deleteCronJob(id);
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, { success: true });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/birds/:id/fly'),
      handler(_req, res, params) {
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid bird ID', 400);
          return;
        }
        const cronJob = getCronJob(id);
        if (!cronJob) {
          jsonError(res, `Bird #${id} not found`, 404);
          return;
        }
        const isSystem = cronJob.name.startsWith(SYSTEM_CRON_PREFIX);
        const job = isSystem
          ? enqueue(
              'system_cron_run',
              { cronJobId: cronJob.id, cronName: cronJob.name },
              { maxAttempts: 3, timeout: 300, cronJobId: cronJob.id },
            )
          : enqueue(
              'cron_run',
              {
                cronJobId: cronJob.id,
                prompt: cronJob.prompt,
                channelId: cronJob.target_channel_id,
                agentId: cronJob.agent_id,
              },
              { cronJobId: cronJob.id },
            );
        json(res, { success: true, jobId: job.id });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/flights'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        const status = url.searchParams.get('status') ?? undefined;
        const birdIdParam = url.searchParams.get('birdId');
        const birdId = birdIdParam ? Number(birdIdParam) : undefined;
        const system = parseSystemFlag(url);
        json(
          res,
          listFlights(
            page,
            perPage,
            { status, birdId, system },
            parseSortParam(url),
            parseSearchParam(url),
          ),
        );
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/birds/:id/flights'),
      handler(req, res, params) {
        const id = Number(params['id']);
        if (!Number.isFinite(id)) {
          jsonError(res, 'Invalid bird ID', 400);
          return;
        }
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        json(
          res,
          listFlights(
            page,
            perPage,
            { birdId: id, system: true },
            parseSortParam(url),
            parseSearchParam(url),
          ),
        );
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
      pattern: pathToRegex('/api/metrics'),
      handler(_req, res) {
        json(res, getErrorRates());
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

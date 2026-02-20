/** @fileoverview HTTP server — JSON API endpoints, SSE streaming, and static file serving for the web UI. */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { Config, AgentConfig } from './core/types.ts';
import { logger } from './core/logger.ts';
import {
  SYSTEM_CRON_PREFIX,
  listSessions,
  listJobs,
  getJobStats,
  listCronJobs,
  getMessageStats,
  countActiveSessions,
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
  deleteOldMessages,
  deleteOldCronRuns,
  deleteOldJobs,
  deleteOldLogs,
  optimizeDatabase,
} from './db.ts';
import { enqueue } from './jobs.ts';
import { getErrorRates } from './core/metrics.ts';
import { checkDoctor } from './cli.ts';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

interface RouteParams {
  [key: string]: string;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, params: RouteParams) => void | Promise<void>;
  skipAuth?: boolean;
}

function pathToRegex(path: string): RegExp {
  const pattern = path.replace(/:(\w+)/g, '(?<$1>[^/]+)');
  return new RegExp(`^${pattern}$`);
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function jsonError(res: ServerResponse, message: string, status: number): void {
  json(res, { error: message }, status);
}

function parsePagination(url: URL): { page: number; perPage: number } {
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  const perPage = Math.max(Number(url.searchParams.get('perPage')) || 20, 1);
  return { page, perPage };
}

function parseSystemFlag(url: URL): boolean {
  return url.searchParams.get('system') === 'true';
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()) as T);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function checkAuth(
  config: Config,
  req: IncomingMessage,
  res: ServerResponse,
  allowQueryToken = false,
): boolean {
  const token = config.web.authToken;
  if (!token) return true;

  const authHeader = req.headers['authorization'] ?? '';
  if (authHeader === `Bearer ${token}`) return true;

  if (allowQueryToken) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const queryToken = url.searchParams.get('token');
    if (queryToken === token) return true;
  }

  jsonError(res, 'Unauthorized', 401);
  return false;
}

function buildRoutes(config: Config, startedAt: number, deps: WebServerDeps): Route[] {
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
        const messages = getMessageStats();
        const activeSessions = countActiveSessions(config.sessions.ttlHours);
        json(res, {
          uptime: uptimeMs,
          sessions: { active: activeSessions, maxConcurrent: config.sessions.maxConcurrent },
          jobs,
          messages,
          cron: { enabled: config.cron.enabled },
          web: { enabled: config.web.enabled, port: config.web.port },
          browser: { enabled: config.browser.enabled },
          slack: { connected: deps.slackConnected() },
        });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/config'),
      handler(_req, res) {
        json(res, {
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
            longResponseMode: config.sessions.longResponseMode,
          },
          slack: {
            coalesce: config.slack.coalesce,
            permissions: config.slack.permissions,
            quietHours: config.slack.quietHours,
          },
          cron: config.cron,
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
        json(res, listSessions(page, perPage));
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
        json(res, listJobs(page, perPage, { status, cronJobId, name }));
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
        json(res, listCronJobs(page, perPage, parseSystemFlag(url)));
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
        let body: { schedule?: string; prompt?: string; channel?: string; agent?: string };
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
        );
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
        let body: { schedule?: string; prompt?: string; channel?: string | null; agent?: string };
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
        });
        if (updated) {
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
        if (deleteCronJob(id)) {
          json(res, { success: true });
        } else {
          jsonError(res, `Bird #${id} not found`, 404);
        }
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
      method: 'POST',
      pattern: pathToRegex('/api/db/cleanup'),
      async handler(req, res) {
        let body: { days?: number } = {};
        try {
          body = await readJsonBody(req);
        } catch {
          /* empty body is fine, use defaults */
        }
        const days = body.days ?? config.database.retentionDays;
        if (!Number.isFinite(days) || days < 1) {
          jsonError(res, '"days" must be a positive number', 400);
          return;
        }
        const messages = deleteOldMessages(days);
        const cronRuns = deleteOldCronRuns(days);
        const jobs = deleteOldJobs(days);
        const logs = deleteOldLogs(days);
        optimizeDatabase();
        json(res, { messages, cronRuns, jobs, logs });
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
        json(res, getRecentLogs(page, perPage, level, source));
      },
    },
  ];
}

const sseConnections = new Set<ServerResponse>();

function handleSSE(
  config: Config,
  startedAt: number,
  deps: WebServerDeps,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!checkAuth(config, req, res, true)) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  sseConnections.add(res);

  const send = () => {
    const jobs = getJobStats();
    const messages = getMessageStats();
    const activeSessions = countActiveSessions(config.sessions.ttlHours);
    const data = JSON.stringify({
      uptime: Date.now() - startedAt,
      sessions: { active: activeSessions, maxConcurrent: config.sessions.maxConcurrent },
      jobs,
      messages,
      cron: { enabled: config.cron.enabled },
      web: { enabled: config.web.enabled, port: config.web.port },
      browser: { enabled: config.browser.enabled },
      slack: { connected: deps.slackConnected() },
    });
    res.write(`event: status\ndata: ${data}\n\n`);
  };

  send();
  const timer = setInterval(send, 5000);
  req.on('close', () => {
    clearInterval(timer);
    sseConnections.delete(res);
  });
}

function closeAllSSE(): void {
  for (const res of sseConnections) {
    res.end();
  }
  sseConnections.clear();
}

function serveStatic(res: ServerResponse, urlPath: string): void {
  if (!existsSync(WEB_DIR)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Web UI not built');
    return;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = join(WEB_DIR, urlPath);

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    try {
      const indexContent = readFileSync(join(WEB_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexContent);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}

export interface WebServerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface WebServerDeps {
  slackConnected: () => boolean;
}

export function createWebServer(
  config: Config,
  signal: AbortSignal,
  deps: WebServerDeps,
): WebServerHandle {
  const startedAt = Date.now();
  const routes = buildRoutes(config, startedAt, deps);
  let server: Server | null = null;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const urlPath = req.url ?? '/';

    const qIndex = urlPath.indexOf('?');
    const pathOnly = qIndex !== -1 ? urlPath.slice(0, qIndex) : urlPath;

    if (method === 'GET' && pathOnly === '/api/events') {
      handleSSE(config, startedAt, deps, req, res);
      return;
    }

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = pathOnly.match(route.pattern);
      if (!match) continue;

      if (!route.skipAuth && !checkAuth(config, req, res)) return;

      const params = (match.groups ?? {}) as RouteParams;
      try {
        await route.handler(req, res, params);
      } catch (err) {
        logger.error(`api error: ${err instanceof Error ? err.message : String(err)}`);
        jsonError(res, 'Internal server error', 500);
      }
      return;
    }

    if (method === 'GET') {
      serveStatic(res, pathOnly);
      return;
    }

    jsonError(res, 'Not found', 404);
  };

  return {
    start() {
      return new Promise<void>((resolve, reject) => {
        server = createServer((req, res) => {
          requestHandler(req, res).catch((err: unknown) => {
            logger.error(
              `unhandled request error: ${err instanceof Error ? err.message : String(err)}`,
            );
            if (!res.headersSent) {
              jsonError(res, 'Internal server error', 500);
            }
          });
        });

        server.on('error', (err) => {
          reject(err);
        });

        server.listen(config.web.port, config.web.host, () => {
          logger.info(`web server listening on http://${config.web.host}:${config.web.port}`);
          resolve();
        });

        signal.addEventListener('abort', () => {
          server?.close();
        });
      });
    },
    stop() {
      return new Promise<void>((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        closeAllSSE();
        server.close(() => {
          logger.info('web server stopped');
          resolve();
        });
      });
    },
  };
}

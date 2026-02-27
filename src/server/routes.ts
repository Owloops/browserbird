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
import { resolveByUid } from '../db/core.ts';
import type { CronJobRow } from '../db/birds.ts';
import {
  SYSTEM_CRON_PREFIX,
  listSessions,
  getSession,
  getSessionMessages,
  getSessionTokenStats,
  getSessionCount,
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
  getEnabledCronJobs,
  getUserCount,
  getUserByEmail,
  createUser,
  getSetting,
  setSetting,
} from '../db/index.ts';
import {
  hashPassword,
  verifyPassword,
  generateTokenKey,
  getOrCreateSecret,
  signToken,
} from './auth.ts';
import { enqueue } from '../jobs.ts';
import { deriveBirdName } from '../core/utils.ts';
import { checkDoctor } from '../cli/index.ts';
import { parseCron, nextCronMatch } from '../cron/parse.ts';
import { DEFAULTS, loadRawConfig, saveConfig, saveEnvFile } from '../config.ts';
import { resolve } from 'node:path';

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

export interface RouteOptions {
  configPath: string;
  onLaunch: () => Promise<void>;
}

function resolveBirdParam(
  params: Record<string, string>,
  res: import('node:http').ServerResponse,
): CronJobRow | null {
  const uid = params['id'];
  if (!uid) {
    jsonError(res, 'Missing bird ID', 400);
    return null;
  }
  const result = resolveByUid<CronJobRow>('cron_jobs', uid);
  if (!result) {
    jsonError(res, `Bird ${uid} not found`, 404);
    return null;
  }
  if ('ambiguous' in result) {
    jsonError(
      res,
      `Ambiguous bird ID "${uid}" matches ${result.count} birds. Use a longer prefix.`,
      400,
    );
    return null;
  }
  return result.row;
}

export function buildRoutes(
  getConfig: () => Config,
  startedAt: number,
  getDeps: () => WebServerDeps,
  options: RouteOptions,
): Route[] {
  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/auth/check'),
      skipAuth: true,
      handler(_req, res) {
        const count = getUserCount();
        json(res, {
          setupRequired: count === 0,
          authRequired: count > 0,
          onboardingRequired: count > 0 && getSetting('onboarding_completed') !== 'true',
        });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/auth/setup'),
      skipAuth: true,
      async handler(req, res) {
        if (getUserCount() > 0) {
          jsonError(res, 'Setup already completed', 403);
          return;
        }
        let body: { email?: string; password?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.email || typeof body.email !== 'string' || !body.email.trim()) {
          jsonError(res, '"email" is required', 400);
          return;
        }
        if (!body.password || typeof body.password !== 'string' || body.password.length < 8) {
          jsonError(res, 'Password must be at least 8 characters', 400);
          return;
        }
        const email = body.email.trim().toLowerCase();
        const passwordHash = await hashPassword(body.password);
        const tokenKey = generateTokenKey();
        const user = createUser(email, passwordHash, tokenKey);
        const secret = getOrCreateSecret();
        const token = signToken(user.id, tokenKey, secret);
        json(res, { token, user: { id: user.id, email: user.email } }, 201);
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/auth/login'),
      skipAuth: true,
      async handler(req, res) {
        let body: { email?: string; password?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.email || !body.password) {
          jsonError(res, 'Invalid credentials', 401);
          return;
        }
        const user = getUserByEmail(body.email.trim());
        if (!user) {
          jsonError(res, 'Invalid credentials', 401);
          return;
        }
        const valid = await verifyPassword(body.password, user.password_hash);
        if (!valid) {
          jsonError(res, 'Invalid credentials', 401);
          return;
        }
        const secret = getOrCreateSecret();
        const token = signToken(user.id, user.token_key, secret);
        json(res, { token, user: { id: user.id, email: user.email } });
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
        json(res, buildStatusPayload(getConfig, startedAt, getDeps));
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/config'),
      handler(_req, res) {
        const config = getConfig();
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
            channels: config.slack.channels,
            quietHours: config.slack.quietHours,
          },
          birds: config.birds,
          browser: config.browser,
          database: config.database,
          web: { port: config.web.port },
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
        const uid = params['id'];
        if (!uid) {
          jsonError(res, 'Missing session ID', 400);
          return;
        }
        const session = getSession(uid);
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
      pattern: pathToRegex('/api/birds/upcoming'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 5, 1), 20);
        const now = new Date();
        const upcoming: {
          uid: string;
          name: string;
          schedule: string;
          agent_id: string;
          next_run: string;
        }[] = [];
        for (const bird of getEnabledCronJobs()) {
          if (bird.name.startsWith(SYSTEM_CRON_PREFIX)) continue;
          try {
            const schedule = parseCron(bird.schedule);
            const next = nextCronMatch(schedule, now, bird.timezone);
            if (next) {
              upcoming.push({
                uid: bird.uid,
                name: bird.name,
                schedule: bird.schedule,
                agent_id: bird.agent_id,
                next_run: next.toISOString(),
              });
            }
          } catch {
            // skip birds with invalid cron expressions
          }
        }
        upcoming.sort((a, b) => a.next_run.localeCompare(b.next_run));
        json(res, upcoming.slice(0, limit));
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
        const bird = resolveBirdParam(params, res);
        if (!bird) return;
        setCronJobEnabled(bird.uid, true);
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, { success: true });
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/birds/:id/disable'),
      handler(_req, res, params) {
        const bird = resolveBirdParam(params, res);
        if (!bird) return;
        setCronJobEnabled(bird.uid, false);
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, { success: true });
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
        const job = createCronJob(
          deriveBirdName(body.prompt),
          body.schedule.trim(),
          body.prompt.trim(),
          body.channel?.trim() || undefined,
          body.agent?.trim() || undefined,
          body.timezone?.trim() || getConfig().timezone,
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
        const bird = resolveBirdParam(params, res);
        if (!bird) return;
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
        const updated = updateCronJob(bird.uid, {
          schedule: body.schedule?.trim() || undefined,
          prompt: body.prompt?.trim() || undefined,
          name: body.prompt ? deriveBirdName(body.prompt) : undefined,
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
          jsonError(res, `Bird ${bird.uid} not found`, 404);
        }
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/birds/:id'),
      handler(_req, res, params) {
        const bird = resolveBirdParam(params, res);
        if (!bird) return;
        if (bird.name.startsWith(SYSTEM_CRON_PREFIX)) {
          jsonError(res, 'System birds cannot be deleted', 403);
          return;
        }
        deleteCronJob(bird.uid);
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, { success: true });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/birds/:id/fly'),
      handler(_req, res, params) {
        const bird = resolveBirdParam(params, res);
        if (!bird) return;
        const isSystem = bird.name.startsWith(SYSTEM_CRON_PREFIX);
        const job = isSystem
          ? enqueue(
              'system_cron_run',
              { cronJobUid: bird.uid, cronName: bird.name },
              { maxAttempts: 3, timeout: 300, cronJobUid: bird.uid },
            )
          : enqueue(
              'cron_run',
              {
                cronJobUid: bird.uid,
                prompt: bird.prompt,
                channelId: bird.target_channel_id,
                agentId: bird.agent_id,
              },
              { cronJobUid: bird.uid },
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
        const birdUid = url.searchParams.get('birdUid') ?? undefined;
        const system = parseSystemFlag(url);
        json(
          res,
          listFlights(
            page,
            perPage,
            { status, birdUid, system },
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
        const bird = resolveBirdParam(params, res);
        if (!bird) return;
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        json(
          res,
          listFlights(
            page,
            perPage,
            { birdUid: bird.uid, system: true },
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
    {
      method: 'GET',
      pattern: pathToRegex('/api/onboarding/defaults'),
      handler(_req, res) {
        const doctor = checkDoctor();
        const defaultAgent = DEFAULTS.agents[0]!;
        json(res, {
          agent: {
            name: defaultAgent.name,
            provider: defaultAgent.provider,
            model: defaultAgent.model,
            systemPrompt: defaultAgent.systemPrompt,
            maxTurns: defaultAgent.maxTurns,
            channels: defaultAgent.channels,
          },
          browser: {
            enabled: DEFAULTS.browser.enabled,
            mode: DEFAULTS.browser.mode,
          },
          doctor,
        });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/onboarding/slack'),
      async handler(req, res) {
        let body: { botToken?: string; appToken?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.botToken || typeof body.botToken !== 'string' || !body.botToken.trim()) {
          jsonError(res, '"botToken" is required', 400);
          return;
        }
        if (!body.appToken || typeof body.appToken !== 'string' || !body.appToken.trim()) {
          jsonError(res, '"appToken" is required', 400);
          return;
        }

        const botToken = body.botToken.trim();
        const appToken = body.appToken.trim();

        if (!botToken.startsWith('xoxb-')) {
          jsonError(res, 'Bot token must start with xoxb-', 400);
          return;
        }
        if (!appToken.startsWith('xapp-')) {
          jsonError(res, 'App token must start with xapp-', 400);
          return;
        }

        const { WebClient } = await import('@slack/web-api');

        let authResult: Awaited<ReturnType<InstanceType<typeof WebClient>['auth']['test']>>;
        try {
          const client = new WebClient(botToken);
          authResult = await client.auth.test();
        } catch {
          jsonError(res, 'Invalid bot token. Check that you copied the full xoxb- token.', 400);
          return;
        }

        try {
          const appClient = new WebClient(appToken);
          await appClient.apiCall('apps.connections.open');
        } catch {
          jsonError(
            res,
            'Invalid app token. Check that you created an app-level token with the connections:write scope.',
            400,
          );
          return;
        }

        try {
          const envPath = resolve('.env');
          saveEnvFile(envPath, {
            SLACK_BOT_TOKEN: botToken,
            SLACK_APP_TOKEN: appToken,
          });

          const configPath = options.configPath;
          const raw = loadRawConfig(configPath);
          const slack = (raw['slack'] ?? {}) as Record<string, unknown>;
          slack['botToken'] = 'env:SLACK_BOT_TOKEN';
          slack['appToken'] = 'env:SLACK_APP_TOKEN';
          raw['slack'] = slack;
          saveConfig(configPath, raw);

          json(res, {
            valid: true,
            team: authResult.team ?? '',
            botUser: authResult.user ?? '',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          jsonError(res, `Failed to save Slack config: ${msg}`, 500);
        }
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/onboarding/agent'),
      async handler(req, res) {
        let body: {
          name?: string;
          provider?: string;
          model?: string;
          systemPrompt?: string;
          maxTurns?: number;
          channels?: string[];
        };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.name || typeof body.name !== 'string') {
          jsonError(res, '"name" is required', 400);
          return;
        }
        if (!body.provider || typeof body.provider !== 'string') {
          jsonError(res, '"provider" is required', 400);
          return;
        }
        if (!body.model || typeof body.model !== 'string') {
          jsonError(res, '"model" is required', 400);
          return;
        }

        const configPath = options.configPath;
        const raw = loadRawConfig(configPath);
        raw['agents'] = [
          {
            id: 'default',
            name: body.name.trim(),
            provider: body.provider.trim(),
            model: body.model.trim(),
            maxTurns: body.maxTurns ?? DEFAULTS.agents[0]!.maxTurns,
            systemPrompt: body.systemPrompt?.trim() ?? DEFAULTS.agents[0]!.systemPrompt,
            channels: body.channels ?? ['*'],
          },
        ];
        saveConfig(configPath, raw);
        json(res, { agents: raw['agents'] });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/onboarding/auth'),
      async handler(req, res) {
        let body: { apiKey?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.apiKey || typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
          jsonError(res, '"apiKey" is required', 400);
          return;
        }

        const key = body.apiKey.trim();
        let envVar: string;
        if (key.startsWith('sk-ant-oat')) {
          envVar = 'CLAUDE_CODE_OAUTH_TOKEN';
        } else if (key.startsWith('sk-ant-api')) {
          envVar = 'ANTHROPIC_API_KEY';
        } else {
          jsonError(
            res,
            'Only Anthropic keys are supported. Provide an API key (sk-ant-api...) or OAuth token (sk-ant-oat...).',
            400,
          );
          return;
        }

        const envPath = resolve('.env');
        saveEnvFile(envPath, { [envVar]: key });
        json(res, { valid: true });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/onboarding/browser'),
      async handler(req, res) {
        let body: { enabled?: boolean; mode?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }

        const configPath = options.configPath;
        const raw = loadRawConfig(configPath);
        const browser = (raw['browser'] ?? {}) as Record<string, unknown>;
        if (body.enabled !== undefined) browser['enabled'] = body.enabled;
        if (body.mode) browser['mode'] = body.mode;
        raw['browser'] = browser;
        saveConfig(configPath, raw);
        json(res, { browser: raw['browser'] });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/onboarding/complete'),
      async handler(_req, res) {
        try {
          await options.onLaunch();
          setSetting('onboarding_completed', 'true');
          json(res, { success: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          jsonError(res, `Launch failed: ${msg}`, 500);
        }
      },
    },
  ];
}

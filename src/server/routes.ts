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
import { probeBrowser } from './health.ts';
import { parseCron, nextCronMatch } from '../cron/parse.ts';
import {
  DEFAULTS,
  loadRawConfig,
  saveConfig,
  saveEnvFile,
  loadDotEnv,
  deepMerge,
  getBrowserMode,
} from '../config.ts';

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
  envPath: string;
  onLaunch: () => Promise<void>;
  onConfigReload: () => void;
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

const VALID_PROVIDERS = new Set(['claude', 'opencode']);

function maskSecret(value: string | undefined): { set: boolean; hint: string } {
  if (!value) return { set: false, hint: '' };
  const prefixes = ['xoxb-', 'xapp-', 'sk-ant-api', 'sk-ant-oat'];
  const prefix = prefixes.find((p) => value.startsWith(p)) ?? '';
  const tail = value.length > 4 ? value.slice(-4) : '';
  return { set: true, hint: prefix ? `${prefix}...${tail}` : `...${tail}` };
}
const HH_MM_RE = /^\d{2}:\d{2}$/;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'timezone',
  'agents',
  'sessions',
  'slack',
  'birds',
  'browser',
  'database',
]);

function sanitizeConfig(config: Config): object {
  return {
    timezone: config.timezone,
    agents: config.agents.map((a: AgentConfig) => ({
      id: a.id,
      name: a.name,
      provider: a.provider,
      model: a.model,
      fallbackModel: a.fallbackModel ?? null,
      maxTurns: a.maxTurns,
      systemPrompt: a.systemPrompt,
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
    browser: {
      enabled: config.browser.enabled,
      mode: getBrowserMode(),
      novncHost: config.browser.novncHost,
      vncPort: config.browser.vncPort,
      novncPort: config.browser.novncPort,
    },
    database: config.database,
    web: { port: config.web.port },
  };
}

function validateConfigPatch(body: Record<string, unknown>): string | null {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      return `Unknown config key "${key}"`;
    }
  }

  if ('timezone' in body && typeof body['timezone'] !== 'string') {
    return '"timezone" must be a string';
  }

  if ('agents' in body) {
    const agents = body['agents'];
    if (!Array.isArray(agents) || agents.length === 0) {
      return '"agents" must be a non-empty array';
    }
    for (const a of agents as Record<string, unknown>[]) {
      if (!a['id'] || typeof a['id'] !== 'string') return 'Each agent must have a string "id"';
      if (!a['name'] || typeof a['name'] !== 'string')
        return 'Each agent must have a string "name"';
      if (!a['provider'] || !VALID_PROVIDERS.has(a['provider'] as string)) {
        return `Agent "${a['id']}": invalid provider (expected: ${[...VALID_PROVIDERS].join(', ')})`;
      }
      if (!a['model'] || typeof a['model'] !== 'string') {
        return `Agent "${a['id']}": "model" is required`;
      }
      if (!Array.isArray(a['channels']) || (a['channels'] as unknown[]).length === 0) {
        return `Agent "${a['id']}": "channels" must be a non-empty array`;
      }
    }
  }

  if ('sessions' in body) {
    const s = body['sessions'] as Record<string, unknown>;
    if (typeof s !== 'object' || s == null) return '"sessions" must be an object';
    for (const k of ['ttlHours', 'maxConcurrent', 'processTimeoutMs'] as const) {
      if (k in s && (typeof s[k] !== 'number' || (s[k] as number) <= 0)) {
        return `"sessions.${k}" must be a positive number`;
      }
    }
  }

  if ('slack' in body) {
    const sl = body['slack'] as Record<string, unknown>;
    if (typeof sl !== 'object' || sl == null) return '"slack" must be an object';
    if ('requireMention' in sl && typeof sl['requireMention'] !== 'boolean') {
      return '"slack.requireMention" must be a boolean';
    }
    if ('channels' in sl) {
      if (!Array.isArray(sl['channels'])) return '"slack.channels" must be an array';
    }
    if ('coalesce' in sl) {
      const c = sl['coalesce'] as Record<string, unknown>;
      if (typeof c !== 'object' || c == null) return '"slack.coalesce" must be an object';
      if (
        'debounceMs' in c &&
        (typeof c['debounceMs'] !== 'number' || (c['debounceMs'] as number) <= 0)
      ) {
        return '"slack.coalesce.debounceMs" must be a positive number';
      }
      if ('bypassDms' in c && typeof c['bypassDms'] !== 'boolean') {
        return '"slack.coalesce.bypassDms" must be a boolean';
      }
    }
    if ('quietHours' in sl) {
      const q = sl['quietHours'] as Record<string, unknown>;
      if (typeof q !== 'object' || q == null) return '"slack.quietHours" must be an object';
      if ('enabled' in q && typeof q['enabled'] !== 'boolean') {
        return '"slack.quietHours.enabled" must be a boolean';
      }
      if (
        'start' in q &&
        (typeof q['start'] !== 'string' || !HH_MM_RE.test(q['start'] as string))
      ) {
        return '"slack.quietHours.start" must be HH:MM format';
      }
      if ('end' in q && (typeof q['end'] !== 'string' || !HH_MM_RE.test(q['end'] as string))) {
        return '"slack.quietHours.end" must be HH:MM format';
      }
    }
  }

  if ('birds' in body) {
    const b = body['birds'] as Record<string, unknown>;
    if (typeof b !== 'object' || b == null) return '"birds" must be an object';
    if (
      'maxAttempts' in b &&
      (!Number.isInteger(b['maxAttempts']) || (b['maxAttempts'] as number) <= 0)
    ) {
      return '"birds.maxAttempts" must be a positive integer';
    }
  }

  if ('browser' in body) {
    const br = body['browser'] as Record<string, unknown>;
    if (typeof br !== 'object' || br == null) return '"browser" must be an object';
    if ('enabled' in br && typeof br['enabled'] !== 'boolean') {
      return '"browser.enabled" must be a boolean';
    }
    if (
      'novncHost' in br &&
      (typeof br['novncHost'] !== 'string' || !(br['novncHost'] as string).trim())
    ) {
      return '"browser.novncHost" must be a non-empty string';
    }
  }

  if ('database' in body) {
    const d = body['database'] as Record<string, unknown>;
    if (typeof d !== 'object' || d == null) return '"database" must be an object';
    if (
      'retentionDays' in d &&
      (!Number.isInteger(d['retentionDays']) || (d['retentionDays'] as number) <= 0)
    ) {
      return '"database.retentionDays" must be a positive integer';
    }
  }

  return null;
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
      pattern: pathToRegex('/api/healthcheck'),
      skipAuth: true,
      handler(_req, res) {
        json(res, { ok: true });
      },
    },
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
        json(res, sanitizeConfig(getConfig()));
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/config'),
      async handler(req, res) {
        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }

        const error = validateConfigPatch(body);
        if (error) {
          jsonError(res, error, 400);
          return;
        }

        try {
          const raw = loadRawConfig(options.configPath);
          const merged = deepMerge(raw, body);
          saveConfig(options.configPath, merged);
          options.onConfigReload();
          broadcastSSE('invalidate', { resource: 'config' });
          json(res, sanitizeConfig(getConfig()));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          jsonError(res, `Failed to save config: ${msg}`, 500);
        }
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/secrets'),
      handler(_req, res) {
        const activeAnthropicValue =
          process.env['CLAUDE_CODE_OAUTH_TOKEN'] || process.env['ANTHROPIC_API_KEY'];

        json(res, {
          slack: {
            botToken: maskSecret(process.env['SLACK_BOT_TOKEN']),
            appToken: maskSecret(process.env['SLACK_APP_TOKEN']),
          },
          anthropic: maskSecret(activeAnthropicValue),
        });
      },
    },
    {
      method: 'PUT',
      pattern: pathToRegex('/api/secrets/slack'),
      async handler(req, res) {
        let body: { botToken?: string; appToken?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }

        const botToken = body.botToken?.trim();
        const appToken = body.appToken?.trim();

        if (!botToken && !appToken) {
          jsonError(res, 'Provide "botToken" and/or "appToken"', 400);
          return;
        }

        const { WebClient } = await import('@slack/web-api');
        const envVars: Record<string, string> = {};

        if (botToken) {
          if (!botToken.startsWith('xoxb-')) {
            jsonError(res, 'Bot token must start with xoxb-', 400);
            return;
          }
          try {
            const client = new WebClient(botToken);
            await client.auth.test();
          } catch {
            jsonError(res, 'Invalid bot token. Check that you copied the full xoxb- token.', 400);
            return;
          }
          envVars['SLACK_BOT_TOKEN'] = botToken;
        }

        if (appToken) {
          if (!appToken.startsWith('xapp-')) {
            jsonError(res, 'App token must start with xapp-', 400);
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
          envVars['SLACK_APP_TOKEN'] = appToken;
        }

        try {
          const envPath = options.envPath;
          saveEnvFile(envPath, envVars);
          loadDotEnv(envPath);
          options.onConfigReload();
          broadcastSSE('invalidate', { resource: 'secrets' });
          json(res, { success: true, requiresRestart: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          jsonError(res, `Failed to save Slack tokens: ${msg}`, 500);
        }
      },
    },
    {
      method: 'PUT',
      pattern: pathToRegex('/api/secrets/anthropic'),
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
          jsonError(res, 'Invalid key. Expected an Anthropic key starting with sk-ant-...', 400);
          return;
        }

        try {
          const envPath = options.envPath;
          saveEnvFile(envPath, { [envVar]: key });
          loadDotEnv(envPath);
          options.onConfigReload();
          broadcastSSE('invalidate', { resource: 'secrets' });
          json(res, { success: true, requiresRestart: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          jsonError(res, `Failed to save Anthropic key: ${msg}`, 500);
        }
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
        const isRailway = !!process.env['RAILWAY_ENVIRONMENT_NAME'];
        const novncHost = isRailway
          ? 'browserbird-vm.railway.internal'
          : DEFAULTS.browser.novncHost;
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
            novncHost: novncHost,
            novncPort: DEFAULTS.browser.novncPort,
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
          const envPath = options.envPath;
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
          jsonError(res, 'Invalid key. Expected an Anthropic key starting with sk-ant-...', 400);
          return;
        }

        const envPath = options.envPath;
        saveEnvFile(envPath, { [envVar]: key });
        json(res, { valid: true });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/onboarding/browser/probe'),
      async handler(req, res) {
        let body: { host?: string; port?: number };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        const host = body.host?.trim();
        if (!host) {
          jsonError(res, '"host" is required', 400);
          return;
        }
        const port = body.port ?? DEFAULTS.browser.novncPort;
        const reachable = await probeBrowser(host, port);
        json(res, { reachable });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/onboarding/browser'),
      async handler(req, res) {
        let body: { enabled?: boolean; novncHost?: string };
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
        if (body.novncHost !== undefined) browser['novncHost'] = body.novncHost.trim();
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

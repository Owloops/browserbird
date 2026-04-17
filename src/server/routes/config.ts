/** @fileoverview Config, secrets, and doctor API route handlers. */

import type { Config, AgentConfig, PermissionMode } from '../../core/types.ts';
import { PERMISSION_MODES } from '../../core/types.ts';
import type { Route } from '../http.ts';
import { pathToRegex, json, jsonError, readJsonBody } from '../http.ts';
import { broadcastSSE } from '../sse.ts';
import { checkDoctor } from '../../cli/index.ts';
import {
  loadRawConfig,
  saveConfig,
  saveEnvFile,
  loadDotEnv,
  deepMerge,
  getBrowserMode,
} from '../../config.ts';
import { maskSecret } from './index.ts';

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
      model: a.model,
      fallbackModel: a.fallbackModel ?? null,
      maxBudgetUsd: a.maxBudgetUsd ?? null,
      maxTurns: a.maxTurns,
      processTimeoutMs: a.processTimeoutMs ?? null,
      permissionMode: a.permissionMode ?? null,
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
      if (!a['model'] || typeof a['model'] !== 'string') {
        return `Agent "${a['id']}": "model" is required`;
      }
      if (!Array.isArray(a['channels']) || (a['channels'] as unknown[]).length === 0) {
        return `Agent "${a['id']}": "channels" must be a non-empty array`;
      }
      if (
        'maxBudgetUsd' in a &&
        a['maxBudgetUsd'] != null &&
        (typeof a['maxBudgetUsd'] !== 'number' || (a['maxBudgetUsd'] as number) <= 0)
      ) {
        return `Agent "${a['id']}": "maxBudgetUsd" must be a positive number`;
      }
      if (
        'permissionMode' in a &&
        a['permissionMode'] != null &&
        !PERMISSION_MODES.includes(a['permissionMode'] as PermissionMode)
      ) {
        return `Agent "${a['id']}": "permissionMode" must be one of ${PERMISSION_MODES.join(', ')}`;
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
    if (
      'maxConsecutiveFailures' in b &&
      (!Number.isInteger(b['maxConsecutiveFailures']) ||
        (b['maxConsecutiveFailures'] as number) < 0)
    ) {
      return '"birds.maxConsecutiveFailures" must be a non-negative integer';
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
    if ('backups' in d) {
      const bk = d['backups'] as Record<string, unknown>;
      if (typeof bk !== 'object' || bk == null) return '"database.backups" must be an object';
      if (
        'maxCount' in bk &&
        (!Number.isInteger(bk['maxCount']) || (bk['maxCount'] as number) <= 0)
      ) {
        return '"database.backups.maxCount" must be a positive integer';
      }
      if ('auto' in bk && typeof bk['auto'] !== 'boolean') {
        return '"database.backups.auto" must be a boolean';
      }
    }
  }

  return null;
}

export interface ConfigRouteDeps {
  getConfig: () => Config;
  configPath: string;
  envPath: string;
  onConfigReload: () => void;
}

export function buildConfigRoutes(deps: ConfigRouteDeps): Route[] {
  const { getConfig, configPath, envPath, onConfigReload } = deps;

  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/doctor'),
      handler(_req, res) {
        json(res, checkDoctor());
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
          const raw = loadRawConfig(configPath);
          const merged = deepMerge(raw, body);
          saveConfig(configPath, merged);
          onConfigReload();
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
          saveEnvFile(envPath, envVars);
          loadDotEnv(envPath);
          onConfigReload();
          broadcastSSE('invalidate', { resource: 'secrets' });
          json(res, { success: true, requiresRestart: false });
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
          saveEnvFile(envPath, { [envVar]: key });
          loadDotEnv(envPath);
          onConfigReload();
          broadcastSSE('invalidate', { resource: 'secrets' });
          json(res, { success: true, requiresRestart: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          jsonError(res, `Failed to save Anthropic key: ${msg}`, 500);
        }
      },
    },
  ];
}

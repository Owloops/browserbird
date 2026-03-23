/** @fileoverview Onboarding wizard API route handlers. */

import type { Route } from '../http.ts';
import type { Config } from '../../core/types.ts';
import { pathToRegex, json, jsonError, readJsonBody } from '../http.ts';
import { checkDoctor } from '../../cli/index.ts';
import { probeBrowser } from '../health.ts';
import { DEFAULTS, loadRawConfig, saveConfig, saveEnvFile } from '../../config.ts';
import { setSetting } from '../../db/index.ts';
import { maskSecret } from './index.ts';

export interface OnboardingDeps {
  getConfig: () => Config;
  configPath: string;
  envPath: string;
  onLaunch: () => Promise<void>;
}

export function buildOnboardingRoutes(deps: OnboardingDeps): Route[] {
  const { getConfig, configPath, envPath, onLaunch } = deps;

  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/onboarding/defaults'),
      handler(_req, res) {
        const doctor = checkDoctor();
        const config = getConfig();
        const defaultAgent = config.agents[0] ?? DEFAULTS.agents[0]!;
        const isRailway = !!process.env['RAILWAY_ENVIRONMENT_NAME'];
        const novncHost = isRailway
          ? 'browserbird-vm.railway.internal'
          : config.browser.novncHost || DEFAULTS.browser.novncHost;
        json(res, {
          agent: {
            name: defaultAgent.name,
            model: defaultAgent.model,
            systemPrompt: defaultAgent.systemPrompt,
            maxTurns: defaultAgent.maxTurns,
            channels: defaultAgent.channels,
          },
          browser: {
            enabled: config.browser.enabled,
            novncHost: novncHost,
            novncPort: config.browser.novncPort,
          },
          secrets: {
            anthropic: maskSecret(
              process.env['CLAUDE_CODE_OAUTH_TOKEN'] || process.env['ANTHROPIC_API_KEY'],
            ),
            slack: {
              botToken: maskSecret(process.env['SLACK_BOT_TOKEN']),
              appToken: maskSecret(process.env['SLACK_APP_TOKEN']),
            },
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
          saveEnvFile(envPath, {
            SLACK_BOT_TOKEN: botToken,
            SLACK_APP_TOKEN: appToken,
          });

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
        if (!body.model || typeof body.model !== 'string') {
          jsonError(res, '"model" is required', 400);
          return;
        }

        const raw = loadRawConfig(configPath);
        raw['agents'] = [
          {
            id: 'default',
            name: body.name.trim(),
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
          await onLaunch();
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

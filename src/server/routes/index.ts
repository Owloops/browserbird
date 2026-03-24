/** @fileoverview Route orchestrator: shared helpers and buildRoutes entry point. */

import { dirname } from 'node:path';
import type { Config } from '../../core/types.ts';
import type { Route, WebServerDeps } from '../http.ts';
import { buildChatRoutes } from '../chat.ts';
import { buildAuthRoutes } from './auth.ts';
import { buildBirdsRoutes } from './birds.ts';
import { buildConfigRoutes } from './config.ts';
import { buildDataRoutes } from './data.ts';
import { buildDocsRoutes } from './docs.ts';
import { buildKeysRoutes } from './keys.ts';
import { buildBackupsRoutes } from './backups.ts';
import { buildOnboardingRoutes } from './onboarding.ts';

export { buildStatusPayload } from './data.ts';

export interface RouteOptions {
  configPath: string;
  envPath: string;
  onLaunch: () => Promise<void>;
  onConfigReload: () => void;
  onRestart?: (pendingRestore?: string) => void;
}

export function maskSecret(value: string | undefined): { set: boolean; hint: string } {
  if (!value) return { set: false, hint: '' };
  const prefixes = ['xoxb-', 'xapp-', 'sk-ant-api', 'sk-ant-oat'];
  const prefix = prefixes.find((p) => value.startsWith(p)) ?? '';
  const tail = value.length > 4 ? value.slice(-4) : '';
  return { set: true, hint: prefix ? `${prefix}...${tail}` : `...${tail}` };
}

export function buildRoutes(
  getConfig: () => Config,
  startedAt: number,
  getDeps: () => WebServerDeps,
  options: RouteOptions,
): Route[] {
  return [
    ...buildAuthRoutes(),
    ...buildDataRoutes({ getConfig, startedAt, getDeps }),
    ...buildConfigRoutes({
      getConfig,
      configPath: options.configPath,
      envPath: options.envPath,
      onConfigReload: options.onConfigReload,
    }),
    ...buildBirdsRoutes(getConfig),
    ...buildOnboardingRoutes({
      getConfig,
      configPath: options.configPath,
      envPath: options.envPath,
      onLaunch: options.onLaunch,
    }),
    ...buildKeysRoutes(),
    ...buildBackupsRoutes(dirname(options.configPath), getConfig, options.onRestart),
    ...buildDocsRoutes(),
    ...buildChatRoutes(() => getDeps().webChannel()),
  ];
}

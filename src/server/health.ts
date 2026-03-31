/** @fileoverview Cached service health checks for agent CLI and browser connectivity. */

import { connect } from 'node:net';
import type { Config } from '../core/types.ts';
import { logger } from '../core/logger.ts';
import { checkCliAsync } from '../cli/doctor.ts';

export interface ServiceHealth {
  agent: { available: boolean };
  browser: { connected: boolean };
}

const AGENT_CHECK_INTERVAL_MS = 60_000;
const BROWSER_CHECK_INTERVAL_MS = 5_000;
const BROWSER_PROBE_TIMEOUT_MS = 2_000;

let agentAvailable = false;
let agentCheckPending = false;

let browserConnected = false;
let browserCheckPending = false;

function refreshAgent(): void {
  if (agentCheckPending) return;
  agentCheckPending = true;
  checkCliAsync('claude', ['--version'])
    .then((result) => {
      agentAvailable = result.available;
    })
    .catch(() => {
      agentAvailable = false;
    })
    .finally(() => {
      agentCheckPending = false;
    });
}

export function probeBrowser(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, host, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(BROWSER_PROBE_TIMEOUT_MS);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function refreshBrowser(config: Config): void {
  if (!config.browser.enabled || browserCheckPending) return;
  browserCheckPending = true;
  probeBrowser(config.browser.novncHost, config.browser.novncPort)
    .then((ok) => {
      browserConnected = ok;
    })
    .catch(() => {
      browserConnected = false;
    })
    .finally(() => {
      browserCheckPending = false;
    });
}

export function getServiceHealth(config: Config): ServiceHealth {
  return {
    agent: { available: agentAvailable },
    browser: { connected: config.browser.enabled ? browserConnected : false },
  };
}

export function startHealthChecks(getConfig: () => Config, signal: AbortSignal): void {
  refreshAgent();
  refreshBrowser(getConfig());

  const agentTimer = setInterval(() => {
    refreshAgent();
  }, AGENT_CHECK_INTERVAL_MS);

  const browserTimer = setInterval(() => {
    refreshBrowser(getConfig());
  }, BROWSER_CHECK_INTERVAL_MS);

  signal.addEventListener('abort', () => {
    clearInterval(agentTimer);
    clearInterval(browserTimer);
  });

  logger.debug('health checks started');
}

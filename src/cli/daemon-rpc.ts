/**
 * @fileoverview CLI-to-daemon HTTP client.
 *
 * Routes CLI write subcommands through the running daemon's HTTP API rather
 * than opening SQLite directly. The daemon is the sole DB writer; this client
 * is how the CLI participates as a thin caller.
 *
 * URL resolution order (highest to lowest priority):
 *   1. `opts.baseUrl` (explicit override, useful for tests)
 *   2. `BROWSERBIRD_API_URL` env var
 *   3. `opts.config.web.host` + `opts.config.web.port` (loaded from
 *      browserbird.json by the caller)
 *   4. `http://127.0.0.1:18800` (compile-time default matching the config
 *      default)
 *
 * Auth is via Bearer token from `loadCliToken()` (see ./auth.ts for cascade).
 */

import { loadCliToken, describeAuthLookup } from './auth.ts';
import type { Config } from '../core/types.ts';

const DEFAULT_BASE_URL = 'http://127.0.0.1:18800';

export class DaemonError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`daemon returned ${status}: ${body || '(empty body)'}`);
    this.name = 'DaemonError';
    this.status = status;
    this.body = body;
  }
}

export class DaemonUnreachableError extends Error {
  url: string;
  constructor(url: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      [
        `could not reach the browserbird daemon at ${url}`,
        `  reason: ${reason}`,
        '',
        'is the daemon running? start it with: browserbird',
        'or set BROWSERBIRD_API_URL to a reachable daemon.',
      ].join('\n'),
    );
    this.name = 'DaemonUnreachableError';
    this.url = url;
    this.cause = cause;
  }
}

export class DaemonAuthError extends Error {
  constructor() {
    super(
      [
        'not authenticated.',
        describeAuthLookup(),
        '',
        'run `browserbird login` or set BROWSERBIRD_TOKEN to authenticate.',
      ].join('\n'),
    );
    this.name = 'DaemonAuthError';
  }
}

export interface DaemonRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  config?: Config;
  baseUrl?: string;
  /** Skip Authorization header (for pre-auth endpoints like /api/auth/login). */
  skipAuth?: boolean;
}

export function resolveDaemonBaseUrl(opts: { config?: Config; baseUrl?: string } = {}): string {
  if (opts.baseUrl) return opts.baseUrl;
  const envUrl = process.env['BROWSERBIRD_API_URL'];
  if (envUrl && envUrl.length > 0) return envUrl;
  if (opts.config?.web) {
    const { host, port } = opts.config.web;
    return `http://${host}:${port}`;
  }
  return DEFAULT_BASE_URL;
}

export async function daemonRequest<T = unknown>(opts: DaemonRequestOptions): Promise<T> {
  const baseUrl = resolveDaemonBaseUrl(opts);
  const url = baseUrl.replace(/\/+$/, '') + opts.path;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (!opts.skipAuth) {
    const credential = loadCliToken();
    if (!credential) throw new DaemonAuthError();
    headers['Authorization'] = `Bearer ${credential.token}`;
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new DaemonUnreachableError(baseUrl, err);
  }

  if (response.status === 401 || response.status === 403) {
    throw new DaemonAuthError();
  }

  const text = await response.text();

  if (!response.ok) {
    throw new DaemonError(response.status, text);
  }

  if (text.length === 0) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `daemon returned non-JSON response (${response.status}): ${text.slice(0, 200)}`,
    );
  }
}

export async function pingDaemon(
  opts: { config?: Config; baseUrl?: string } = {},
): Promise<boolean> {
  const baseUrl = resolveDaemonBaseUrl(opts);
  try {
    const response = await fetch(baseUrl.replace(/\/+$/, '') + '/api/healthcheck', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

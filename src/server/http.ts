/** @fileoverview HTTP utilities: response helpers, auth, body parsing, and shared types. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebChannel } from '../channel/web.ts';

import { getUserCount } from '../db/auth.ts';
import { verifyToken } from './auth.ts';

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface RouteParams {
  [key: string]: string;
}

export interface Route {
  method: string;
  pattern: RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, params: RouteParams) => void | Promise<void>;
  skipAuth?: boolean;
}

export interface WebServerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface WebServerDeps {
  slackConnected: () => boolean;
  activeProcessCount: () => number;
  serviceHealth: () => { agent: { available: boolean }; browser: { connected: boolean } };
  webChannel: () => WebChannel | null;
}

export function pathToRegex(path: string): RegExp {
  const pattern = path.replace(/:(\w+)/g, '(?<$1>[^/]+)');
  return new RegExp(`^${pattern}$`);
}

export function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function jsonError(res: ServerResponse, message: string, status: number): void {
  json(res, { error: message }, status);
}

export function parsePagination(url: URL): { page: number; perPage: number } {
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  const perPage = Math.max(Number(url.searchParams.get('perPage')) || 20, 1);
  return { page, perPage };
}

export function parseSystemFlag(url: URL): boolean {
  return url.searchParams.get('system') === 'true';
}

export function parseSortParam(url: URL): string | undefined {
  return url.searchParams.get('sort') ?? undefined;
}

export function parseSearchParam(url: URL): string | undefined {
  return url.searchParams.get('search') ?? undefined;
}

import type { Binding } from '../db/core.ts';
import { resolveByUid } from '../db/core.ts';

export function resolveRouteParam<T>(
  table: string,
  label: string,
  params: Record<string, string>,
  res: ServerResponse,
): T | null {
  const uid = params['id'];
  if (!uid) {
    jsonError(res, `Missing ${label} ID`, 400);
    return null;
  }
  const result = resolveByUid<T>(table, uid);
  if (!result) {
    jsonError(res, `${label} ${uid} not found`, 404);
    return null;
  }
  if ('ambiguous' in result) {
    jsonError(
      res,
      `Ambiguous ${label} ID "${uid}" matches ${result.count} ${label.toLowerCase()}s. Use a longer prefix.`,
      400,
    );
    return null;
  }
  return result.row;
}

export function validateBindings(body: unknown, res: ServerResponse): Binding[] | null {
  if (!Array.isArray(body)) {
    jsonError(res, 'Body must be an array of bindings', 400);
    return null;
  }
  for (const b of body as Binding[]) {
    if (b.targetType !== 'channel' && b.targetType !== 'bird') {
      jsonError(res, '"targetType" must be "channel" or "bird"', 400);
      return null;
    }
    if (!b.targetId || typeof b.targetId !== 'string') {
      jsonError(res, '"targetId" is required', 400);
      return null;
    }
  }
  return body as Binding[];
}

const MAX_BODY_BYTES = 1024 * 1024;

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
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

function extractToken(req: IncomingMessage, allowQueryToken: boolean): string | null {
  const authHeader = req.headers['authorization'] ?? '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);

  if (allowQueryToken) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    return url.searchParams.get('token');
  }

  return null;
}

/**
 * Verifies the request is authenticated. In setup mode (no users in DB),
 * all requests are allowed. Otherwise, a valid signed token is required.
 */
export function checkAuth(
  req: IncomingMessage,
  res: ServerResponse,
  allowQueryToken = false,
): boolean {
  if (getUserCount() === 0) return true;

  const token = extractToken(req, allowQueryToken);
  if (!token || !verifyToken(token)) {
    jsonError(res, 'Unauthorized', 401);
    return false;
  }

  return true;
}

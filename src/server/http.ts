/** @fileoverview HTTP utilities — response helpers, auth, body parsing, and shared types. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../core/types.ts';

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

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
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

export function checkAuth(
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

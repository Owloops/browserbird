/** @fileoverview Server-Sent Events: connection management and broadcasting. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../core/types.ts';
import type { WebServerDeps } from './http.ts';
import { checkAuth } from './http.ts';
import { buildStatusPayload } from './routes.ts';

const sseConnections = new Set<ServerResponse>();

export function handleSSE(
  getConfig: () => Config,
  startedAt: number,
  getDeps: () => WebServerDeps,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!checkAuth(req, res, true)) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  sseConnections.add(res);

  const send = () => {
    const data = JSON.stringify(buildStatusPayload(getConfig, startedAt, getDeps));
    res.write(`event: status\ndata: ${data}\n\n`);
  };

  send();
  const timer = setInterval(send, 5000);
  req.on('close', () => {
    clearInterval(timer);
    sseConnections.delete(res);
  });
}

export function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseConnections) {
    if (!res.destroyed) res.write(payload);
  }
}

export function closeAllSSE(): void {
  for (const res of sseConnections) {
    res.end();
  }
  sseConnections.clear();
}

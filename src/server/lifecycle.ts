/** @fileoverview Web server lifecycle — creation, request routing, and shutdown. */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { Config } from '../core/types.ts';
import { logger } from '../core/logger.ts';
import { insertLog } from '../db/index.ts';
import type { WebServerDeps, WebServerHandle } from './http.ts';
import { checkAuth, jsonError } from './http.ts';
import { buildRoutes } from './routes.ts';
import { handleSSE, closeAllSSE } from './sse.ts';
import { serveStatic } from './static.ts';
import { handleVncUpgrade } from './vnc-proxy.ts';

export function createWebServer(
  config: Config,
  signal: AbortSignal,
  deps: WebServerDeps,
): WebServerHandle {
  const startedAt = Date.now();
  const routes = buildRoutes(config, startedAt, deps);
  let server: Server | null = null;

  const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const urlPath = req.url ?? '/';

    const qIndex = urlPath.indexOf('?');
    const pathOnly = qIndex !== -1 ? urlPath.slice(0, qIndex) : urlPath;

    if (method === 'GET' && pathOnly === '/api/events') {
      handleSSE(config, startedAt, deps, req, res);
      return;
    }

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = pathOnly.match(route.pattern);
      if (!match) continue;

      if (!route.skipAuth && !checkAuth(config, req, res)) return;

      const params = (match.groups ?? {}) as Record<string, string>;
      try {
        await route.handler(req, res, params);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`api error: ${msg}`);
        insertLog('error', 'api', msg);
        jsonError(res, 'Internal server error', 500);
      }
      return;
    }

    if (method === 'GET') {
      serveStatic(res, pathOnly);
      return;
    }

    jsonError(res, 'Not found', 404);
  };

  return {
    start() {
      return new Promise<void>((resolve, reject) => {
        server = createServer((req, res) => {
          requestHandler(req, res).catch((err: unknown) => {
            logger.error(
              `unhandled request error: ${err instanceof Error ? err.message : String(err)}`,
            );
            if (!res.headersSent) {
              jsonError(res, 'Internal server error', 500);
            }
          });
        });

        server.on('upgrade', (req, socket, head) => {
          const url = req.url ?? '/';
          const pathOnly = url.indexOf('?') !== -1 ? url.slice(0, url.indexOf('?')) : url;
          if (pathOnly === '/vnc') {
            handleVncUpgrade(config, req, socket, head);
          } else {
            socket.destroy();
          }
        });

        server.on('error', (err) => {
          reject(err);
        });

        server.listen(config.web.port, config.web.host, () => {
          logger.info(`web server listening on http://${config.web.host}:${config.web.port}`);
          resolve();
        });

        signal.addEventListener('abort', () => {
          server?.close();
        });
      });
    },
    stop() {
      return new Promise<void>((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        closeAllSSE();
        server.close(() => {
          logger.info('web server stopped');
          resolve();
        });
      });
    },
  };
}

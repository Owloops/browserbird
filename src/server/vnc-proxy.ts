/** @fileoverview WebSocket proxy for VNC — tunnels browser connections to upstream noVNC. */

import { connect } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Config } from '../core/types.ts';
import { logger } from '../core/logger.ts';

function destroyWithStatus(socket: Duplex, status: number, message: string): void {
  const body = `HTTP/1.1 ${status} ${message}\r\n\r\n`;
  socket.end(body);
}

function checkUpgradeAuth(config: Config, req: IncomingMessage): boolean {
  const token = config.web.authToken;
  if (!token) return true;

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  return url.searchParams.get('token') === token;
}

export function handleVncUpgrade(
  config: Config,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  if (!config.browser.enabled) {
    destroyWithStatus(socket, 404, 'Not Found');
    return;
  }

  if (!checkUpgradeAuth(config, req)) {
    destroyWithStatus(socket, 403, 'Forbidden');
    return;
  }

  const { novncHost, novncPort } = config.browser;

  logger.info(`vnc proxy connecting to ${novncHost}:${novncPort}`);

  const upstream = connect(novncPort, novncHost, () => {
    logger.info(`vnc proxy connected to ${novncHost}:${novncPort}`);
    const httpVersion = req.httpVersion;

    let rawHeaders = `GET /websockify HTTP/${httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      rawHeaders += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    rawHeaders += '\r\n';

    upstream.write(rawHeaders);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on('error', (err) => {
    const code = (err as { code?: string }).code ?? '';
    logger.error(`vnc proxy upstream error: ${code} ${err.message}`);
    socket.destroy();
  });

  socket.on('error', (err) => {
    const code = (err as { code?: string }).code ?? '';
    logger.error(`vnc proxy client error: ${code} ${err.message}`);
    upstream.destroy();
  });

  upstream.on('close', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
}

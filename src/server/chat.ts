/** @fileoverview Chat API route handlers for web-based conversations. */

import type { Route } from './http.ts';
import type { WebChannel } from '../channel/web.ts';

import { pathToRegex, json, jsonError, readJsonBody } from './http.ts';
import { randomUUID } from 'node:crypto';

export function buildChatRoutes(getWebChannel: () => WebChannel | null): Route[] {
  return [
    {
      method: 'POST',
      pattern: pathToRegex('/api/chat/send'),
      async handler(req, res) {
        const channel = getWebChannel();
        if (!channel) {
          jsonError(res, 'Web chat is not available', 503);
          return;
        }

        let body: { sessionUid?: string; message?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }

        if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
          jsonError(res, '"message" is required', 400);
          return;
        }

        const sessionUid = body.sessionUid || randomUUID();
        channel.sendMessage(sessionUid, body.message.trim());
        json(res, { sessionUid });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/chat/stop'),
      async handler(req, res) {
        const channel = getWebChannel();
        if (!channel) {
          jsonError(res, 'Web chat is not available', 503);
          return;
        }

        let body: { sessionUid?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }

        if (!body.sessionUid || typeof body.sessionUid !== 'string') {
          jsonError(res, '"sessionUid" is required', 400);
          return;
        }

        const killed = channel.killSession(body.sessionUid);
        json(res, { stopped: killed });
      },
    },
  ];
}

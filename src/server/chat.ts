/** @fileoverview Chat API route handlers for web-based conversations. */

import type { Route } from './http.ts';
import type { WebChannel } from '../channel/web.ts';

import { pathToRegex, json, jsonError, readJsonBody } from './http.ts';
import { generateUid, UID_PREFIX } from '../core/uid.ts';
import { getSession } from '../db/index.ts';

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

        let threadId: string;

        if (body.sessionUid) {
          const session = getSession(body.sessionUid);
          if (!session) {
            jsonError(res, 'Session not found', 404);
            return;
          }
          if (!session.thread_id) {
            jsonError(res, 'Session has no thread ID', 400);
            return;
          }
          threadId = session.thread_id;
          channel.sendMessage(session.channel_id, threadId, body.message.trim());
        } else {
          threadId = generateUid(UID_PREFIX.webThread);
          channel.sendMessage('web', threadId, body.message.trim());
        }

        json(res, { threadId });
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

        let body: { sessionUid?: string; channelId?: string; threadId?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }

        let stopped = false;

        if (body.sessionUid) {
          const session = getSession(body.sessionUid);
          if (session?.thread_id) {
            stopped = channel.killSession(session.channel_id, session.thread_id);
          }
        } else if (body.channelId && body.threadId) {
          stopped = channel.killSession(body.channelId, body.threadId);
        } else {
          jsonError(res, '"sessionUid" or "channelId"+"threadId" is required', 400);
          return;
        }

        json(res, { stopped });
      },
    },
  ];
}

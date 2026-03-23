/** @fileoverview Keys vault API route handlers. */

import type { Route } from '../http.ts';
import type { Binding } from '../../db/core.ts';
import {
  pathToRegex,
  json,
  jsonError,
  readJsonBody,
  parsePagination,
  parseSortParam,
  parseSearchParam,
  validateBindings,
} from '../http.ts';
import { broadcastSSE } from '../sse.ts';
import {
  listKeys,
  getKey,
  createKey,
  updateKey,
  deleteKey,
  replaceBindings,
} from '../../db/index.ts';
import { validateKeyName } from '../../db/keys.ts';
import { addSecrets, VAULT_SECRET_MIN_LENGTH } from '../../core/redact.ts';

export function buildKeysRoutes(): Route[] {
  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/keys'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        json(res, listKeys(page, perPage, parseSortParam(url), parseSearchParam(url)));
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/keys'),
      async handler(req, res) {
        let body: { name?: string; value?: string; description?: string; bindings?: Binding[] };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
          jsonError(res, '"name" is required', 400);
          return;
        }
        if (!body.value || typeof body.value !== 'string') {
          jsonError(res, '"value" is required', 400);
          return;
        }
        const validated = validateKeyName(body.name);
        if ('error' in validated) {
          jsonError(res, validated.error, 400);
          return;
        }
        const { name } = validated;
        try {
          const key = createKey(name, body.value, body.description?.trim());
          addSecrets([body.value], VAULT_SECRET_MIN_LENGTH);
          if (body.bindings && body.bindings.length > 0) {
            replaceBindings(key.uid, body.bindings);
          }
          broadcastSSE('invalidate', { resource: 'keys' });
          json(res, { uid: key.uid }, 201);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('UNIQUE constraint')) {
            jsonError(res, `A key named "${name}" already exists`, 409);
          } else {
            jsonError(res, msg, 500);
          }
        }
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/keys/:id'),
      async handler(req, res, params) {
        const uid = params['id'];
        if (!uid) {
          jsonError(res, 'Missing key ID', 400);
          return;
        }
        const existing = getKey(uid);
        if (!existing) {
          jsonError(res, `Key ${uid} not found`, 404);
          return;
        }
        let body: { name?: string; value?: string; description?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        const fields: { name?: string; value?: string; description?: string } = {};
        if (body.name !== undefined) {
          const validated = validateKeyName(body.name);
          if ('error' in validated) {
            jsonError(res, validated.error, 400);
            return;
          }
          fields.name = validated.name;
        }
        if (body.value !== undefined && body.value !== '') {
          fields.value = body.value;
        }
        if (body.description !== undefined) {
          fields.description = body.description;
        }
        try {
          const updated = updateKey(uid, fields);
          if (!updated) {
            jsonError(res, `Key ${uid} not found`, 404);
            return;
          }
          if (fields.value) addSecrets([fields.value], VAULT_SECRET_MIN_LENGTH);
          broadcastSSE('invalidate', { resource: 'keys' });
          json(res, { uid: updated.uid });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('UNIQUE constraint')) {
            jsonError(res, `A key named "${fields.name}" already exists`, 409);
          } else {
            jsonError(res, msg, 500);
          }
        }
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/keys/:id'),
      handler(_req, res, params) {
        const uid = params['id'];
        if (!uid) {
          jsonError(res, 'Missing key ID', 400);
          return;
        }
        if (deleteKey(uid)) {
          broadcastSSE('invalidate', { resource: 'keys' });
          json(res, { success: true });
        } else {
          jsonError(res, `Key ${uid} not found`, 404);
        }
      },
    },
    {
      method: 'PUT',
      pattern: pathToRegex('/api/keys/:id/bindings'),
      async handler(req, res, params) {
        const uid = params['id'];
        if (!uid) {
          jsonError(res, 'Missing key ID', 400);
          return;
        }
        const existing = getKey(uid);
        if (!existing) {
          jsonError(res, `Key ${uid} not found`, 404);
          return;
        }
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        const bindings = validateBindings(body, res);
        if (!bindings) return;
        replaceBindings(uid, bindings);
        broadcastSSE('invalidate', { resource: 'keys' });
        json(res, { success: true });
      },
    },
  ];
}

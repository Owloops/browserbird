/** @fileoverview Docs API route handlers. */

import type { Route } from '../http.ts';
import type { DocRow } from '../../db/docs.ts';
import {
  pathToRegex,
  json,
  jsonError,
  readJsonBody,
  parsePagination,
  parseSortParam,
  parseSearchParam,
  resolveRouteParam,
  validateBindings,
} from '../http.ts';
import { broadcastSSE } from '../sse.ts';
import {
  listDocs,
  docRowToInfo,
  createDoc,
  updateDoc,
  deleteDoc,
  setDocPinned,
  replaceDocBindings,
} from '../../db/index.ts';

export function buildDocsRoutes(): Route[] {
  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/docs'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        json(res, listDocs(page, perPage, parseSortParam(url), parseSearchParam(url)));
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/docs'),
      async handler(req, res) {
        let body: { title?: string; content?: string };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
          jsonError(res, '"title" is required', 400);
          return;
        }
        const doc = createDoc(body.title.trim(), body.content?.trim());
        broadcastSSE('invalidate', { resource: 'docs' });
        json(res, doc, 201);
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/docs/:id'),
      handler(_req, res, params) {
        const doc = resolveRouteParam<DocRow>('docs', 'Doc', params, res);
        if (!doc) return;
        json(res, docRowToInfo(doc));
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/docs/:id'),
      async handler(req, res, params) {
        const doc = resolveRouteParam<DocRow>('docs', 'Doc', params, res);
        if (!doc) return;
        let body: { title?: string; content?: string; pinned?: boolean };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        const fields: { title?: string; content?: string; pinned?: number } = {};
        if (body.title !== undefined) fields.title = body.title;
        if (body.content !== undefined) fields.content = body.content;
        if (body.pinned !== undefined) fields.pinned = body.pinned ? 1 : 0;
        const updated = updateDoc(doc.uid, fields);
        if (updated) {
          broadcastSSE('invalidate', { resource: 'docs' });
          json(res, updated);
        } else {
          jsonError(res, `Doc ${doc.uid} not found`, 404);
        }
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/docs/:id'),
      handler(_req, res, params) {
        const doc = resolveRouteParam<DocRow>('docs', 'Doc', params, res);
        if (!doc) return;
        deleteDoc(doc.uid);
        broadcastSSE('invalidate', { resource: 'docs' });
        json(res, { success: true });
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/docs/:id/pin'),
      handler(_req, res, params) {
        const doc = resolveRouteParam<DocRow>('docs', 'Doc', params, res);
        if (!doc) return;
        setDocPinned(doc.uid, true);
        broadcastSSE('invalidate', { resource: 'docs' });
        json(res, { success: true });
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/docs/:id/unpin'),
      handler(_req, res, params) {
        const doc = resolveRouteParam<DocRow>('docs', 'Doc', params, res);
        if (!doc) return;
        setDocPinned(doc.uid, false);
        broadcastSSE('invalidate', { resource: 'docs' });
        json(res, { success: true });
      },
    },
    {
      method: 'PUT',
      pattern: pathToRegex('/api/docs/:id/bindings'),
      async handler(req, res, params) {
        const doc = resolveRouteParam<DocRow>('docs', 'Doc', params, res);
        if (!doc) return;
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        const bindings = validateBindings(body, res);
        if (!bindings) return;
        replaceDocBindings(doc.uid, bindings);
        broadcastSSE('invalidate', { resource: 'docs' });
        json(res, { success: true });
      },
    },
  ];
}

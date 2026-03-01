/** @fileoverview Static file serving for the web UI. */

import type { ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { MIME_TYPES } from './http.ts';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');

export function serveStatic(res: ServerResponse, urlPath: string): void {
  if (!existsSync(WEB_DIR)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Web UI not built');
    return;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = join(WEB_DIR, urlPath);

  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    try {
      const indexContent = readFileSync(join(WEB_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexContent);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}

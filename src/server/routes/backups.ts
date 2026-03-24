/** @fileoverview Backup API route handlers. */

import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { Route } from '../http.ts';
import type { Config } from '../../core/types.ts';
import { pathToRegex, json, jsonError, readJsonBody, checkAuth } from '../http.ts';
import { broadcastSSE } from '../sse.ts';
import {
  createBackup,
  listBackups,
  deleteBackup,
  enforceRetention,
  isValidBackupName,
} from '../../core/backup.ts';

function validateName(name: string | undefined): name is string {
  return !!name && isValidBackupName(name);
}

export function buildBackupsRoutes(
  dataDir: string,
  getConfig: () => Config,
  onRestart?: (pendingRestore?: string) => void,
): Route[] {
  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/backups'),
      handler(_req, res) {
        json(res, listBackups(dataDir));
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/backups'),
      async handler(req, res) {
        let body: { name?: string } = {};
        try {
          body = await readJsonBody(req);
        } catch {
          // empty body is fine
        }
        try {
          const info = createBackup(dataDir, body.name ?? undefined);
          const maxCount = getConfig().database.backups?.maxCount ?? 10;
          enforceRetention(dataDir, maxCount);
          broadcastSSE('invalidate', { resource: 'backups' });
          json(res, info, 201);
        } catch (err) {
          jsonError(res, (err as Error).message, 409);
        }
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/backups/:name'),
      skipAuth: true,
      handler(req, res, params) {
        const name = params['name'];
        if (!validateName(name)) {
          jsonError(res, 'Invalid backup name', 400);
          return;
        }
        if (!checkAuth(req, res, true)) return;
        const filePath = join(dataDir, 'backups', name);
        const stream = createReadStream(filePath);
        stream.on('error', () => {
          if (!res.headersSent) {
            jsonError(res, `Backup "${name}" not found`, 404);
          }
        });
        stream.on('open', () => {
          res.writeHead(200, {
            'Content-Type': 'application/gzip',
            'Content-Disposition': `attachment; filename="${name}"`,
          });
          stream.pipe(res);
        });
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/backups/:name'),
      handler(_req, res, params) {
        const name = params['name'];
        if (!validateName(name)) {
          jsonError(res, 'Invalid backup name', 400);
          return;
        }
        try {
          deleteBackup(dataDir, name);
          broadcastSSE('invalidate', { resource: 'backups' });
          json(res, { success: true });
        } catch (err) {
          jsonError(res, (err as Error).message, 404);
        }
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/backups/:name/restore'),
      handler(_req, res, params) {
        const name = params['name'];
        if (!validateName(name)) {
          jsonError(res, 'Invalid backup name', 400);
          return;
        }
        if (!onRestart) {
          jsonError(res, 'Restart not available', 500);
          return;
        }
        json(res, { success: true, message: 'Backup restored. Restarting...' });
        onRestart(name);
      },
    },
  ];
}

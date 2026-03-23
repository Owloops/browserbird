/** @fileoverview Birds and flights API route handlers. */

import type { Route } from '../http.ts';
import type { Config } from '../../core/types.ts';
import type { CronJobRow } from '../../db/birds.ts';
import {
  pathToRegex,
  json,
  jsonError,
  readJsonBody,
  parsePagination,
  parseSystemFlag,
  parseSortParam,
  parseSearchParam,
  resolveRouteParam,
} from '../http.ts';
import { broadcastSSE } from '../sse.ts';
import {
  SYSTEM_CRON_PREFIX,
  listCronJobs,
  listFlights,
  setCronJobEnabled,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  getEnabledCronJobs,
} from '../../db/index.ts';
import { enqueue } from '../../jobs.ts';
import { deriveBirdName } from '../../core/utils.ts';
import { parseCron, nextCronMatch } from '../../cron/parse.ts';

function resolveBird(
  params: Record<string, string>,
  res: import('node:http').ServerResponse,
): CronJobRow | null {
  return resolveRouteParam<CronJobRow>('cron_jobs', 'Bird', params, res);
}

export function buildBirdsRoutes(getConfig: () => Config): Route[] {
  return [
    {
      method: 'GET',
      pattern: pathToRegex('/api/birds/upcoming'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 5, 1), 20);
        const now = new Date();
        const upcoming: {
          uid: string;
          name: string;
          schedule: string;
          agent_id: string;
          next_run: string;
        }[] = [];
        for (const bird of getEnabledCronJobs()) {
          if (bird.name.startsWith(SYSTEM_CRON_PREFIX)) continue;
          try {
            const schedule = parseCron(bird.schedule);
            const next = nextCronMatch(schedule, now, getConfig().timezone);
            if (next) {
              upcoming.push({
                uid: bird.uid,
                name: bird.name,
                schedule: bird.schedule,
                agent_id: bird.agent_id,
                next_run: next.toISOString(),
              });
            }
          } catch {
            // skip birds with invalid cron expressions
          }
        }
        upcoming.sort((a, b) => a.next_run.localeCompare(b.next_run));
        json(res, upcoming.slice(0, limit));
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/birds'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        json(
          res,
          listCronJobs(
            page,
            perPage,
            parseSystemFlag(url),
            parseSortParam(url),
            parseSearchParam(url),
          ),
        );
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/birds/:id/enable'),
      handler(_req, res, params) {
        const bird = resolveBird(params, res);
        if (!bird) return;
        setCronJobEnabled(bird.uid, true);
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, { success: true });
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/birds/:id/disable'),
      handler(_req, res, params) {
        const bird = resolveBird(params, res);
        if (!bird) return;
        setCronJobEnabled(bird.uid, false);
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, { success: true });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/birds'),
      async handler(req, res) {
        let body: {
          schedule?: string;
          prompt?: string;
          channel?: string;
          agent?: string;
          activeHoursStart?: string;
          activeHoursEnd?: string;
        };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        if (!body.schedule || typeof body.schedule !== 'string' || !body.schedule.trim()) {
          jsonError(res, '"schedule" is required', 400);
          return;
        }
        if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
          jsonError(res, '"prompt" is required', 400);
          return;
        }
        const job = createCronJob(
          deriveBirdName(body.prompt),
          body.schedule.trim(),
          body.prompt.trim(),
          body.channel?.trim() || undefined,
          body.agent?.trim() || undefined,
          body.activeHoursStart?.trim() || undefined,
          body.activeHoursEnd?.trim() || undefined,
        );
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, job, 201);
      },
    },
    {
      method: 'PATCH',
      pattern: pathToRegex('/api/birds/:id'),
      async handler(req, res, params) {
        const bird = resolveBird(params, res);
        if (!bird) return;
        let body: {
          schedule?: string;
          prompt?: string;
          channel?: string | null;
          agent?: string;
          activeHoursStart?: string | null;
          activeHoursEnd?: string | null;
        };
        try {
          body = await readJsonBody(req);
        } catch {
          jsonError(res, 'Invalid JSON body', 400);
          return;
        }
        const updated = updateCronJob(bird.uid, {
          schedule: body.schedule?.trim() || undefined,
          prompt: body.prompt?.trim() || undefined,
          name: body.prompt ? deriveBirdName(body.prompt) : undefined,
          targetChannelId: body.channel !== undefined ? body.channel?.trim() || null : undefined,
          agentId: body.agent?.trim() || undefined,
          activeHoursStart:
            body.activeHoursStart !== undefined ? body.activeHoursStart?.trim() || null : undefined,
          activeHoursEnd:
            body.activeHoursEnd !== undefined ? body.activeHoursEnd?.trim() || null : undefined,
        });
        if (updated) {
          broadcastSSE('invalidate', { resource: 'birds' });
          json(res, updated);
        } else {
          jsonError(res, `Bird ${bird.uid} not found`, 404);
        }
      },
    },
    {
      method: 'DELETE',
      pattern: pathToRegex('/api/birds/:id'),
      handler(_req, res, params) {
        const bird = resolveBird(params, res);
        if (!bird) return;
        if (bird.name.startsWith(SYSTEM_CRON_PREFIX)) {
          jsonError(res, 'System birds cannot be deleted', 403);
          return;
        }
        deleteCronJob(bird.uid);
        broadcastSSE('invalidate', { resource: 'birds' });
        json(res, { success: true });
      },
    },
    {
      method: 'POST',
      pattern: pathToRegex('/api/birds/:id/fly'),
      handler(_req, res, params) {
        const bird = resolveBird(params, res);
        if (!bird) return;
        const isSystem = bird.name.startsWith(SYSTEM_CRON_PREFIX);
        const job = isSystem
          ? enqueue(
              'system_cron_run',
              { cronJobUid: bird.uid, cronName: bird.name },
              { maxAttempts: 3, timeout: 300, cronJobUid: bird.uid },
            )
          : enqueue(
              'cron_run',
              {
                cronJobUid: bird.uid,
                prompt: bird.prompt,
                channelId: bird.target_channel_id,
                agentId: bird.agent_id,
              },
              { cronJobUid: bird.uid },
            );
        json(res, { success: true, jobId: job.id });
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/flights'),
      handler(req, res) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        const status = url.searchParams.get('status') ?? undefined;
        const birdUid = url.searchParams.get('birdUid') ?? undefined;
        const system = parseSystemFlag(url);
        json(
          res,
          listFlights(
            page,
            perPage,
            { status, birdUid, system },
            parseSortParam(url),
            parseSearchParam(url),
          ),
        );
      },
    },
    {
      method: 'GET',
      pattern: pathToRegex('/api/birds/:id/flights'),
      handler(req, res, params) {
        const bird = resolveBird(params, res);
        if (!bird) return;
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const { page, perPage } = parsePagination(url);
        json(
          res,
          listFlights(
            page,
            perPage,
            { birdUid: bird.uid, system: true },
            parseSortParam(url),
            parseSearchParam(url),
          ),
        );
      },
    },
  ];
}

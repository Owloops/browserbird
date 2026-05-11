/** @fileoverview Tests for daemonRequest auth + error handling against a real local HTTP server. */

import { describe, it, before, after, beforeEach } from 'node:test';
import { strictEqual, deepStrictEqual, rejects } from 'node:assert';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonInvalidTokenError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

interface CapturedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

const ENV_KEYS = ['BROWSERBIRD_TOKEN', 'BROWSERBIRD_CREDENTIALS', 'BROWSERBIRD_API_URL'] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

interface FakeServer {
  baseUrl: string;
  close(): Promise<void>;
  requests: CapturedRequest[];
  respond(handler: (req: CapturedRequest, res: ServerResponse) => void): void;
}

async function startFakeServer(): Promise<FakeServer> {
  const requests: CapturedRequest[] = [];
  let handler: (req: CapturedRequest, res: ServerResponse) => void = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const bodyChunks: Buffer[] = [];
    req.on('data', (c: Buffer) => bodyChunks.push(c));
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        authorization: req.headers['authorization'] as string | undefined,
        body: Buffer.concat(bodyChunks).toString('utf-8'),
      };
      requests.push(captured);
      handler(captured, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    requests,
    respond(h) {
      handler = h;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

describe('daemonRequest', () => {
  let server: FakeServer;
  let savedEnv: Record<string, string | undefined>;

  before(async () => {
    server = await startFakeServer();
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  });

  after(async () => {
    await server.close();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    clearEnv();
    server.requests.length = 0;
    server.respond((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    process.env['BROWSERBIRD_API_URL'] = server.baseUrl;
  });

  it('throws DaemonAuthError when no credential is configured', async () => {
    await rejects(
      daemonRequest({ method: 'GET', path: '/api/ping' }),
      (err: unknown) => err instanceof DaemonAuthError && !(err instanceof DaemonInvalidTokenError),
    );
    strictEqual(server.requests.length, 0);
  });

  it('sends Bearer header when BROWSERBIRD_TOKEN is set', async () => {
    process.env['BROWSERBIRD_TOKEN'] = 'tok-abc';
    const result = await daemonRequest<{ ok: boolean }>({ method: 'GET', path: '/api/ping' });
    deepStrictEqual(result, { ok: true });
    strictEqual(server.requests.length, 1);
    strictEqual(server.requests[0]!.authorization, 'Bearer tok-abc');
  });

  it('omits Authorization header when skipAuth=true', async () => {
    const result = await daemonRequest<{ ok: boolean }>({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'x@y.z', password: 'p' },
      skipAuth: true,
    });
    deepStrictEqual(result, { ok: true });
    strictEqual(server.requests[0]!.authorization, undefined);
  });

  it('serializes JSON body and sets Content-Type', async () => {
    process.env['BROWSERBIRD_TOKEN'] = 'tok-abc';
    await daemonRequest({ method: 'POST', path: '/api/x', body: { foo: 'bar' } });
    deepStrictEqual(JSON.parse(server.requests[0]!.body), { foo: 'bar' });
  });

  it('throws DaemonInvalidTokenError on 401', async () => {
    process.env['BROWSERBIRD_TOKEN'] = 'bad-token';
    server.respond((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
    });
    await rejects(daemonRequest({ method: 'GET', path: '/api/ping' }), (err: unknown) => {
      if (!(err instanceof DaemonInvalidTokenError)) return false;
      strictEqual(err.status, 401);
      return true;
    });
  });

  it('throws DaemonInvalidTokenError on 403', async () => {
    process.env['BROWSERBIRD_TOKEN'] = 'tok-abc';
    server.respond((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
    });
    await rejects(daemonRequest({ method: 'GET', path: '/api/ping' }), (err: unknown) => {
      return err instanceof DaemonInvalidTokenError && err.status === 403;
    });
  });

  it('throws DaemonError on other non-2xx statuses', async () => {
    process.env['BROWSERBIRD_TOKEN'] = 'tok-abc';
    server.respond((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
    await rejects(daemonRequest({ method: 'GET', path: '/api/ping' }), (err: unknown) => {
      if (!(err instanceof DaemonError)) return false;
      strictEqual(err.status, 500);
      return true;
    });
  });

  it('throws DaemonUnreachableError when network connection fails', async () => {
    process.env['BROWSERBIRD_TOKEN'] = 'tok-abc';
    process.env['BROWSERBIRD_API_URL'] = 'http://127.0.0.1:1'; // closed port
    await rejects(
      daemonRequest({ method: 'GET', path: '/api/ping' }),
      (err: unknown) => err instanceof DaemonUnreachableError,
    );
  });

  it('returns undefined for empty 2xx responses', async () => {
    process.env['BROWSERBIRD_TOKEN'] = 'tok-abc';
    server.respond((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const result = await daemonRequest({ method: 'DELETE', path: '/api/x' });
    strictEqual(result, undefined);
  });

  it('respects baseUrl override over BROWSERBIRD_API_URL env', async () => {
    process.env['BROWSERBIRD_TOKEN'] = 'tok-abc';
    process.env['BROWSERBIRD_API_URL'] = 'http://127.0.0.1:1'; // would fail if used
    const result = await daemonRequest<{ ok: boolean }>({
      method: 'GET',
      path: '/api/ping',
      baseUrl: server.baseUrl,
    });
    deepStrictEqual(result, { ok: true });
  });
});

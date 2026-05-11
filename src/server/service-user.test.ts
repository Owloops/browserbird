/** @fileoverview Tests for service user provisioning and token signing. */

import { describe, it, before, after } from 'node:test';
import { strictEqual, notStrictEqual, throws } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, closeDatabase } from '../db/index.ts';
import { verifyToken, extractUserIdFromToken } from './auth.ts';
import { ensureServiceUser, signServiceToken, SERVICE_USER_EMAIL } from './service-user.ts';

describe('service-user', () => {
  let tmpRoot: string;
  let dbPath: string;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bb-service-user-test-'));
    dbPath = join(tmpRoot, 'test.db');
    openDatabase(dbPath);
  });

  after(() => {
    closeDatabase();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('ensureServiceUser creates the service user on first call', async () => {
    const user = await ensureServiceUser();
    strictEqual(user.email, SERVICE_USER_EMAIL);
    strictEqual(typeof user.id, 'number');
    strictEqual(typeof user.token_key, 'string');
    strictEqual(user.token_key.length > 0, true);
  });

  it('ensureServiceUser is idempotent: second call returns the same row', async () => {
    const first = await ensureServiceUser();
    const second = await ensureServiceUser();
    strictEqual(second.id, first.id);
    strictEqual(second.token_key, first.token_key);
  });

  it('signServiceToken yields a token verifyToken accepts', async () => {
    await ensureServiceUser();
    const token = signServiceToken();
    strictEqual(token.split('.').length, 3);
    strictEqual(verifyToken(token), true);
  });

  it('extractUserIdFromToken returns the service user id', async () => {
    const user = await ensureServiceUser();
    const token = signServiceToken();
    strictEqual(extractUserIdFromToken(token), user.id);
  });

  it('expired tokens (negative ttlMs) fail verification', async () => {
    await ensureServiceUser();
    const token = signServiceToken(-1);
    strictEqual(verifyToken(token), false);
  });

  it('tampered tokens fail verification', async () => {
    await ensureServiceUser();
    const token = signServiceToken();
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    strictEqual(verifyToken(tampered), false);
  });

  it('signServiceToken throws when service user is missing', () => {
    closeDatabase();
    openDatabase(join(tmpRoot, 'empty.db'));
    throws(() => signServiceToken(), /service user/);
    closeDatabase();
    openDatabase(dbPath);
  });

  it('two distinct sign calls yield different jti values', async () => {
    await ensureServiceUser();
    const a = signServiceToken();
    const b = signServiceToken();
    notStrictEqual(a, b);
  });
});

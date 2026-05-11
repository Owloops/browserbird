/** @fileoverview Tests for output redaction patterns. */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, closeDatabase } from '../db/index.ts';
import { ensureServiceUser, signServiceToken } from '../server/service-user.ts';
import { redact, addSecrets } from './redact.ts';

describe('redact: token patterns', () => {
  it('redacts xoxb- slack bot tokens', () => {
    const out = redact('token=xoxb-1234567890-abcdefghijkl');
    strictEqual(out, 'token=[redacted]');
  });

  it('redacts xapp- slack app tokens', () => {
    const out = redact('token=xapp-1-abc123def456789');
    strictEqual(out, 'token=[redacted]');
  });

  it('redacts sk-ant-api anthropic api keys', () => {
    const out = redact('key=sk-ant-api03-abc123def456789');
    strictEqual(out, 'key=[redacted]');
  });

  it('redacts sk-ant-oat anthropic oauth tokens', () => {
    const out = redact('key=sk-ant-oat01-abc123def456789');
    strictEqual(out, 'key=[redacted]');
  });

  it('does not redact short strings that start with a prefix', () => {
    const out = redact('xoxb-short');
    strictEqual(out, 'xoxb-short');
  });

  it('does not redact random base64-looking strings', () => {
    const garbage = 'abcdefABCDEF0123456789_-abcdefABCDEF0123456789';
    const out = redact(garbage);
    strictEqual(out, garbage);
  });

  it('does not redact ordinary prose', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    strictEqual(redact(text), text);
  });
});

describe('redact: browserbird-issued JWTs', () => {
  let tmpRoot: string;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bb-redact-test-'));
    openDatabase(join(tmpRoot, 'test.db'));
    await ensureServiceUser();
  });

  after(() => {
    closeDatabase();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('redacts a real signed service token', () => {
    const token = signServiceToken();
    const out = redact(`Authorization: Bearer ${token}`);
    strictEqual(out, 'Authorization: Bearer [redacted]');
  });

  it('redacts the JWT even when surrounded by other text', () => {
    const token = signServiceToken();
    const out = redact(`error: token ${token} was rejected`);
    strictEqual(out.includes(token), false);
    ok(out.includes('[redacted]'));
  });

  it('does not redact a non-HS256-header JWT-shaped string', () => {
    const fake = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';
    strictEqual(redact(fake), fake);
  });
});

describe('redact: env-derived secrets', () => {
  it('addSecrets respects min length filter', () => {
    addSecrets(['abc'], 4);
    strictEqual(redact('abc'), 'abc');
  });

  it('addSecrets registers values meeting min length', () => {
    addSecrets(['my-unique-test-secret-123'], 4);
    strictEqual(redact('see my-unique-test-secret-123 here'), 'see [redacted] here');
  });
});

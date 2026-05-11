/** @fileoverview Tests for loadCliToken cascade and credentials-file parsing. */

import { describe, it, before, after, beforeEach } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCliToken } from './auth.ts';

const ENV_KEYS = ['BROWSERBIRD_TOKEN', 'BROWSERBIRD_CREDENTIALS', 'XDG_CONFIG_HOME'] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe('loadCliToken cascade', () => {
  let tmpRoot: string;
  let dataDirPath: string;
  let xdgPath: string;
  let customCredsPath: string;
  let savedEnv: Record<string, string | undefined>;

  before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bb-auth-test-'));
    dataDirPath = join(tmpRoot, 'data-dir', '.credentials.json');
    xdgPath = join(tmpRoot, 'xdg', 'browserbird', 'credentials.json');
    customCredsPath = join(tmpRoot, 'custom.json');
    mkdirSync(join(tmpRoot, 'data-dir'), { recursive: true });
    mkdirSync(join(tmpRoot, 'xdg', 'browserbird'), { recursive: true });
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  });

  after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    clearEnv();
    rmSync(dataDirPath, { force: true });
    rmSync(xdgPath, { force: true });
    rmSync(customCredsPath, { force: true });
  });

  it('returns null when nothing is configured', () => {
    const result = loadCliToken({ dataDirPath, xdgPath });
    strictEqual(result, null);
  });

  it('BROWSERBIRD_TOKEN env wins over everything', () => {
    process.env['BROWSERBIRD_TOKEN'] = 'env-token';
    writeFileSync(customCredsPath, JSON.stringify({ token: 'custom-token' }));
    process.env['BROWSERBIRD_CREDENTIALS'] = customCredsPath;
    writeFileSync(dataDirPath, JSON.stringify({ token: 'data-token' }));
    writeFileSync(xdgPath, JSON.stringify({ token: 'xdg-token' }));
    const result = loadCliToken({ dataDirPath, xdgPath });
    deepStrictEqual(result, {
      token: 'env-token',
      source: { kind: 'env', origin: 'BROWSERBIRD_TOKEN' },
    });
  });

  it('BROWSERBIRD_CREDENTIALS env beats data-dir and XDG', () => {
    writeFileSync(customCredsPath, JSON.stringify({ token: 'custom-token' }));
    process.env['BROWSERBIRD_CREDENTIALS'] = customCredsPath;
    writeFileSync(dataDirPath, JSON.stringify({ token: 'data-token' }));
    writeFileSync(xdgPath, JSON.stringify({ token: 'xdg-token' }));
    const result = loadCliToken({ dataDirPath, xdgPath });
    deepStrictEqual(result, {
      token: 'custom-token',
      source: { kind: 'file', origin: customCredsPath },
    });
  });

  it('data-dir file beats XDG when no env is set', () => {
    writeFileSync(dataDirPath, JSON.stringify({ token: 'data-token' }));
    writeFileSync(xdgPath, JSON.stringify({ token: 'xdg-token' }));
    const result = loadCliToken({ dataDirPath, xdgPath });
    deepStrictEqual(result, {
      token: 'data-token',
      source: { kind: 'file', origin: dataDirPath },
    });
  });

  it('falls through to XDG when data-dir file is absent', () => {
    writeFileSync(xdgPath, JSON.stringify({ token: 'xdg-token' }));
    const result = loadCliToken({ dataDirPath, xdgPath });
    deepStrictEqual(result, {
      token: 'xdg-token',
      source: { kind: 'file', origin: xdgPath },
    });
  });

  it('skips malformed JSON and continues the cascade', () => {
    writeFileSync(dataDirPath, '{ this is not json');
    writeFileSync(xdgPath, JSON.stringify({ token: 'xdg-token' }));
    const result = loadCliToken({ dataDirPath, xdgPath });
    deepStrictEqual(result, {
      token: 'xdg-token',
      source: { kind: 'file', origin: xdgPath },
    });
  });

  it('skips files missing the token field and continues', () => {
    writeFileSync(dataDirPath, JSON.stringify({ notToken: 'whatever' }));
    writeFileSync(xdgPath, JSON.stringify({ token: 'xdg-token' }));
    const result = loadCliToken({ dataDirPath, xdgPath });
    deepStrictEqual(result, {
      token: 'xdg-token',
      source: { kind: 'file', origin: xdgPath },
    });
  });

  it('skips files with empty token string', () => {
    writeFileSync(dataDirPath, JSON.stringify({ token: '' }));
    writeFileSync(xdgPath, JSON.stringify({ token: 'xdg-token' }));
    const result = loadCliToken({ dataDirPath, xdgPath });
    strictEqual(result?.token, 'xdg-token');
  });

  it('returns null when BROWSERBIRD_CREDENTIALS points at a missing file and no other source exists', () => {
    process.env['BROWSERBIRD_CREDENTIALS'] = join(tmpRoot, 'does-not-exist.json');
    const result = loadCliToken({ dataDirPath, xdgPath });
    strictEqual(result, null);
  });

  it('ignores empty BROWSERBIRD_TOKEN', () => {
    process.env['BROWSERBIRD_TOKEN'] = '';
    writeFileSync(xdgPath, JSON.stringify({ token: 'xdg-token' }));
    const result = loadCliToken({ dataDirPath, xdgPath });
    strictEqual(result?.token, 'xdg-token');
  });
});

/**
 * @fileoverview CLI-side credential resolution for talking to the daemon.
 *
 * Resolves a Bearer token from a cascading set of sources, in priority order:
 *
 *   1. `BROWSERBIRD_TOKEN` env var
 *   2. `BROWSERBIRD_CREDENTIALS` env var (path to a custom credentials file)
 *   3. `<DATA_DIR>/.credentials.json` (deployment-local, persists on a mounted
 *      data volume like Railway)
 *   4. `~/.config/browserbird/credentials.json` (XDG-style developer-laptop
 *      default, matches the convention used by gh/kubectl/docker/terraform)
 *
 * The first source that yields a token wins. Missing files are skipped
 * silently; malformed files emit a warning to stderr and the cascade
 * continues. All sources exhausted returns null; the caller decides how to
 * surface the failure to the user.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { DATA_DIR } from '../core/paths.ts';

interface CredentialsFile {
  token: string;
}

export interface CredentialSource {
  kind: 'env' | 'file';
  origin: string;
}

export interface ResolvedCredential {
  token: string;
  source: CredentialSource;
}

function dataDirCredentialsPath(): string {
  return resolve(DATA_DIR, '.credentials.json');
}

function xdgCredentialsPath(): string {
  const xdgConfigHome = process.env['XDG_CONFIG_HOME'];
  const configHome =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : resolve(homedir(), '.config');
  return resolve(configHome, 'browserbird', 'credentials.json');
}

function readCredentialsFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CredentialsFile>;
    if (typeof parsed.token !== 'string' || parsed.token.length === 0) {
      process.stderr.write(`warning: ${path} has no usable token field; skipping\n`);
      return null;
    }
    return parsed.token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`warning: could not read ${path}: ${msg}; skipping\n`);
    return null;
  }
}

export function loadCliToken(): ResolvedCredential | null {
  const envToken = process.env['BROWSERBIRD_TOKEN'];
  if (envToken && envToken.length > 0) {
    return { token: envToken, source: { kind: 'env', origin: 'BROWSERBIRD_TOKEN' } };
  }

  const credsPathFromEnv = process.env['BROWSERBIRD_CREDENTIALS'];
  if (credsPathFromEnv && credsPathFromEnv.length > 0) {
    const token = readCredentialsFile(credsPathFromEnv);
    if (token) {
      return { token, source: { kind: 'file', origin: credsPathFromEnv } };
    }
  }

  const dataDirPath = dataDirCredentialsPath();
  const dataDirToken = readCredentialsFile(dataDirPath);
  if (dataDirToken) {
    return { token: dataDirToken, source: { kind: 'file', origin: dataDirPath } };
  }

  const xdgPath = xdgCredentialsPath();
  const xdgToken = readCredentialsFile(xdgPath);
  if (xdgToken) {
    return { token: xdgToken, source: { kind: 'file', origin: xdgPath } };
  }

  return null;
}

export function describeAuthLookup(): string {
  return [
    'looked for credentials in:',
    '  - $BROWSERBIRD_TOKEN env var',
    '  - $BROWSERBIRD_CREDENTIALS env var (custom file path)',
    `  - ${dataDirCredentialsPath()}`,
    `  - ${xdgCredentialsPath()}`,
  ].join('\n');
}

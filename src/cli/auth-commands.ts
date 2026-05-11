/**
 * @fileoverview Human-CLI auth subcommands: login, logout, whoami.
 *
 * `login` collects credentials, exchanges them with the daemon for a JWT,
 * and persists the token to either the data dir (`--system`) or the
 * XDG-style config dir under the user's home (default).
 *
 * `logout` removes the persisted token file.
 *
 * `whoami` displays the currently authenticated principal by calling
 * `GET /api/auth/me` using whatever credential `loadCliToken` resolves.
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, chmodSync } from 'node:fs';
import { logger } from '../core/logger.ts';
import { c } from './style.ts';
import { DATA_DIR } from '../core/paths.ts';
import { promptLine, promptSecret } from './prompt.ts';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

export const AUTH_HELP = `
${c('cyan', 'usage:')} browserbird <login|logout|whoami> [options]

manage CLI authentication to the running daemon.

${c('dim', 'subcommands:')}

  ${c('cyan', 'login')}                authenticate and save a token
  ${c('cyan', 'logout')}               clear the saved token
  ${c('cyan', 'whoami')}               show the currently authenticated user

${c('dim', 'options:')}

  ${c('yellow', '--email')} <addr>     email to log in with (login)
  ${c('yellow', '--system')}           save credentials to <DATA_DIR>/.credentials.json
                          instead of ~/.config/browserbird/credentials.json
  ${c('yellow', '--url')} <url>        daemon URL override (env: BROWSERBIRD_API_URL)
  ${c('yellow', '-h, --help')}         show this help
`.trim();

function xdgCredentialsPath(): string {
  const xdgConfigHome = process.env['XDG_CONFIG_HOME'];
  const configHome =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : resolve(homedir(), '.config');
  return resolve(configHome, 'browserbird', 'credentials.json');
}

function dataDirCredentialsPath(): string {
  return resolve(DATA_DIR, '.credentials.json');
}

function pickWritePath(system: boolean): string {
  return system ? dataDirCredentialsPath() : xdgCredentialsPath();
}

function writeCredentialsFile(path: string, token: string): void {
  const dir = resolve(path, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ token }, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on systems without chmod semantics
  }
}

async function runDaemonCall<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (
      err instanceof DaemonAuthError ||
      err instanceof DaemonUnreachableError ||
      err instanceof DaemonError
    ) {
      logger.error(err.message);
      process.exitCode = 1;
      return undefined;
    }
    throw err;
  }
}

export async function handleLogin(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      email: { type: 'string' },
      system: { type: 'boolean', default: false },
      url: { type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  });

  const email = (values.email as string | undefined)?.trim() || (await promptLine('email: '));
  if (!email) {
    logger.error('email is required');
    process.exitCode = 1;
    return;
  }
  const password = await promptSecret(`password for ${email}: `);
  if (!password) {
    logger.error('password is required');
    process.exitCode = 1;
    return;
  }

  const result = await runDaemonCall<{ token: string; user: { id: number; email: string } }>(() =>
    daemonRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email, password },
      baseUrl: values.url as string | undefined,
      skipAuth: true,
    }),
  );
  if (!result) return;

  const path = pickWritePath(values.system as boolean);
  writeCredentialsFile(path, result.token);
  logger.success(`logged in as ${result.user.email}`);
  process.stderr.write(c('dim', `  credentials saved to ${path}`) + '\n');
}

export function handleLogout(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { system: { type: 'boolean', default: false } },
    allowPositionals: false,
    strict: false,
  });
  const path = pickWritePath(values.system as boolean);
  if (!existsSync(path)) {
    logger.info(`no credentials file at ${path}`);
    return;
  }
  try {
    unlinkSync(path);
    logger.success(`removed credentials at ${path}`);
  } catch (err) {
    logger.error(`could not remove ${path}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

export async function handleWhoami(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { url: { type: 'string' } },
    allowPositionals: false,
    strict: false,
  });
  const me = await runDaemonCall<{ id: number; email: string; isService: boolean }>(() =>
    daemonRequest({
      method: 'GET',
      path: '/api/auth/me',
      baseUrl: values.url as string | undefined,
    }),
  );
  if (!me) return;
  const label = me.isService ? c('dim', '(service user)') : '';
  console.log(`${me.email} ${label}`.trim());
}

/**
 * @fileoverview Service-user lifecycle: the auto-created identity browserbird
 * uses internally for daemon-spawned agent CLI subprocesses.
 *
 * The service user lives in the `users` table like any human user but is never
 * meant to log in via password. Its password hash is a one-shot random value
 * that is discarded; only `token_key` is used (to sign short-lived JWTs that
 * the daemon hands to spawned subprocesses via the BROWSERBIRD_TOKEN env var).
 *
 * Scope: today the service user has the same privileges as any other user
 * (browserbird does not yet implement RBAC). When roles are added, scope this
 * identity to the minimum the agent CLI subprocesses need.
 */

import { randomBytes } from 'node:crypto';
import { getUserByEmail, createUser, type UserRow } from '../db/auth.ts';
import {
  hashPassword,
  generateTokenKey,
  getOrCreateSecret,
  signToken,
  SERVICE_TOKEN_TTL_MS,
} from './auth.ts';
import { logger } from '../core/logger.ts';

export const SERVICE_USER_EMAIL = 'service@browserbird.local';

export function isServiceUser(user: { email: string }): boolean {
  return user.email.toLowerCase() === SERVICE_USER_EMAIL;
}

export async function ensureServiceUser(): Promise<UserRow> {
  const existing = getUserByEmail(SERVICE_USER_EMAIL);
  if (existing) return existing;

  const unusablePassword = randomBytes(32).toString('hex');
  const passwordHash = await hashPassword(unusablePassword);
  const tokenKey = generateTokenKey();
  const created = createUser(SERVICE_USER_EMAIL, passwordHash, tokenKey);
  logger.debug(`service user provisioned (id=${created.id})`);
  return created;
}

export function signServiceToken(ttlMs: number = SERVICE_TOKEN_TTL_MS): string {
  const user = getUserByEmail(SERVICE_USER_EMAIL);
  if (!user) {
    throw new Error(
      `service user "${SERVICE_USER_EMAIL}" not found; call ensureServiceUser() during startup`,
    );
  }
  const secret = getOrCreateSecret();
  return signToken(user.id, user.token_key, secret, ttlMs);
}

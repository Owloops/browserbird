/** @fileoverview Password hashing, token signing, and verification using node:crypto. */

import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { getUserById, getSetting, setSetting } from '../db/auth.ts';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_BYTES);
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(
        `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`,
      );
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      resolve(false);
      return;
    }
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, 'hex');
    const expected = Buffer.from(parts[5]!, 'hex');

    scrypt(password, salt, expected.length, { N: n, r, p }, (err, key) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(timingSafeEqual(key, expected));
    });
  });
}

export function generateTokenKey(): string {
  return randomBytes(32).toString('hex');
}

export function getOrCreateSecret(): string {
  const existing = getSetting('auth_secret');
  if (existing) return existing;
  const secret = randomBytes(32).toString('hex');
  setSetting('auth_secret', secret);
  return secret;
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString('base64url');
}

function base64UrlDecode(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString();
}

function hmacSign(data: string, key: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

export interface TokenPayload {
  sub: number;
  exp: number;
  iat: number;
  jti: string;
}

export function signToken(userId: number, tokenKey: string, secret: string): string {
  const now = Date.now();
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      exp: now + TOKEN_EXPIRY_MS,
      iat: now,
      jti: randomBytes(16).toString('hex'),
    }),
  );
  const signingKey = tokenKey + secret;
  const signature = hmacSign(`${header}.${payload}`, signingKey);
  return `${header}.${payload}.${signature}`;
}

/**
 * Verifies a raw token string: structure, signature, expiry, and that the
 * user still exists in the DB. Returns true if valid, false otherwise.
 */
export function verifyToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  let sub: number;
  try {
    const decoded = JSON.parse(base64UrlDecode(parts[1]!)) as { sub?: number };
    if (typeof decoded.sub !== 'number') return false;
    sub = decoded.sub;
  } catch {
    return false;
  }

  const user = getUserById(sub);
  if (!user) return false;

  const secret = getOrCreateSecret();
  const [header, payload, signature] = parts as [string, string, string];
  const signingKey = user.token_key + secret;
  const expected = hmacSign(`${header}.${payload}`, signingKey);

  const sigBuf = Buffer.from(signature, 'base64url');
  const expBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as TokenPayload;
    if (typeof decoded.exp !== 'number' || decoded.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

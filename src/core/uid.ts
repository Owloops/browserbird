/** @fileoverview Prefixed short ID generation (PocketBase/Motebase pattern). */

import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const UID_PREFIX = {
  bird: 'br_',
  flight: 'fl_',
  session: 'ss_',
} as const;

export function generateUid(prefix: string): string {
  const bytes = randomBytes(15);
  let id = prefix;
  for (let i = 0; i < 15; i++) {
    id += ALPHABET[bytes[i]! % 36];
  }
  return id;
}

export function shortUid(uid: string): string {
  const i = uid.indexOf('_');
  if (i === -1) return uid.slice(0, 10);
  return uid.slice(0, i + 1 + 7);
}

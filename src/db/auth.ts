/** @fileoverview User and settings persistence for the auth system. */

import { getDb } from './core.ts';

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  token_key: string;
  created_at: string;
}

export function getUserCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM users').get() as unknown as {
    count: number;
  };
  return row.count;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as
    | UserRow
    | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as
    | UserRow
    | undefined;
}

export function createUser(email: string, passwordHash: string, tokenKey: string): UserRow {
  getDb()
    .prepare('INSERT INTO users (email, password_hash, token_key) VALUES (?, ?, ?)')
    .run(email, passwordHash, tokenKey);

  return getUserByEmail(email)!;
}

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

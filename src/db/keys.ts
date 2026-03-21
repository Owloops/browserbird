/** @fileoverview Vault key persistence: CRUD and spawn-time resolution. */

import type { PaginatedResult } from './core.ts';
import { getDb, transaction, paginate, DEFAULT_PER_PAGE } from './core.ts';
import { generateUid, UID_PREFIX } from '../core/uid.ts';
import { encrypt, decrypt, isEncrypted, getVaultKey } from '../core/crypto.ts';

export interface KeyRow {
  uid: string;
  name: string;
  value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeyBinding {
  targetType: 'channel' | 'bird';
  targetId: string;
}

export interface KeyInfo {
  uid: string;
  name: string;
  hint: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  bindings: KeyBinding[];
}

function decryptValue(raw: string): string {
  return isEncrypted(raw) ? decrypt(raw, getVaultKey()) : raw;
}

function computeHint(raw: string): string {
  const value = decryptValue(raw);
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

const KEY_SORT_COLUMNS = new Set(['uid', 'name', 'created_at', 'updated_at']);
const KEY_SEARCH_COLUMNS = ['uid', 'name', 'description'] as const;

function loadBindingsMap(): Map<string, KeyBinding[]> {
  const d = getDb();
  const bindings = d
    .prepare('SELECT * FROM key_bindings ORDER BY key_uid')
    .all() as unknown as Array<{
    id: number;
    key_uid: string;
    target_type: 'channel' | 'bird';
    target_id: string;
  }>;
  const map = new Map<string, KeyBinding[]>();
  for (const b of bindings) {
    let arr = map.get(b.key_uid);
    if (!arr) {
      arr = [];
      map.set(b.key_uid, arr);
    }
    arr.push({ targetType: b.target_type, targetId: b.target_id });
  }
  return map;
}

function enrichKeys(result: PaginatedResult<KeyRow>): PaginatedResult<KeyInfo> {
  const bindingsByKey = loadBindingsMap();
  return {
    ...result,
    items: result.items.map((row) => ({
      uid: row.uid,
      name: row.name,
      hint: computeHint(row.value),
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      bindings: bindingsByKey.get(row.uid) ?? [],
    })),
  };
}

export function listKeys(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  sort?: string,
  search?: string,
): PaginatedResult<KeyInfo> {
  const result = paginate<KeyRow>('keys', page, perPage, {
    defaultSort: 'name ASC',
    sort,
    search,
    allowedSortColumns: KEY_SORT_COLUMNS,
    searchColumns: KEY_SEARCH_COLUMNS,
  });
  return enrichKeys(result);
}

export function getKey(uid: string): KeyRow | undefined {
  const d = getDb();
  return d.prepare('SELECT * FROM keys WHERE uid = ?').get(uid) as unknown as KeyRow | undefined;
}

export function createKey(name: string, value: string, description?: string): KeyRow {
  const d = getDb();
  const uid = generateUid(UID_PREFIX.key);
  const encrypted = encrypt(value, getVaultKey());
  d.prepare('INSERT INTO keys (uid, name, value, description) VALUES (?, ?, ?, ?)').run(
    uid,
    name,
    encrypted,
    description ?? null,
  );
  return getKey(uid)!;
}

export function updateKey(
  uid: string,
  fields: { name?: string; value?: string; description?: string },
): KeyRow | undefined {
  const d = getDb();
  const sets: string[] = [];
  const params: (string | null)[] = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    params.push(fields.name);
  }
  if (fields.value !== undefined) {
    sets.push('value = ?');
    params.push(encrypt(fields.value, getVaultKey()));
  }
  if (fields.description !== undefined) {
    sets.push('description = ?');
    params.push(fields.description || null);
  }

  if (sets.length === 0) return getKey(uid);

  sets.push("updated_at = datetime('now')");
  params.push(uid);

  const result = d.prepare(`UPDATE keys SET ${sets.join(', ')} WHERE uid = ?`).run(...params);
  if (result.changes === 0) return undefined;
  return getKey(uid);
}

export function deleteKey(uid: string): boolean {
  const d = getDb();
  const result = d.prepare('DELETE FROM keys WHERE uid = ?').run(uid);
  return result.changes > 0;
}

export function replaceBindings(keyUid: string, bindings: KeyBinding[]): void {
  transaction(() => {
    const d = getDb();
    d.prepare('DELETE FROM key_bindings WHERE key_uid = ?').run(keyUid);
    const stmt = d.prepare(
      'INSERT INTO key_bindings (key_uid, target_type, target_id) VALUES (?, ?, ?)',
    );
    for (const b of bindings) {
      stmt.run(keyUid, b.targetType, b.targetId);
    }
  });
}

export function getKeysForTarget(
  targetType: 'channel' | 'bird',
  targetId: string,
): Array<{ name: string; value: string }> {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT k.name, k.value FROM keys k
       JOIN key_bindings kb ON kb.key_uid = k.uid
       WHERE kb.target_type = ? AND (kb.target_id = ? OR kb.target_id = '*')`,
    )
    .all(targetType, targetId) as unknown as Array<{ name: string; value: string }>;
  return rows.map((r) => ({ name: r.name, value: decryptValue(r.value) }));
}

/** Resolves keys for one or more targets into a flat env map. Later targets override earlier ones. */
export function resolveExtraEnv(
  targets: Array<{ type: 'channel' | 'bird'; id: string }>,
): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const t of targets) {
    for (const k of getKeysForTarget(t.type, t.id)) {
      env[k.name] = k.value;
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

export function getAllKeyValues(): string[] {
  const d = getDb();
  const rows = d.prepare('SELECT value FROM keys').all() as unknown as Array<{ value: string }>;
  return rows.map((r) => decryptValue(r.value));
}

export function migrateUnencryptedKeys(): void {
  const d = getDb();
  const rows = d.prepare('SELECT uid, value FROM keys').all() as unknown as Array<{
    uid: string;
    value: string;
  }>;
  const vaultKey = getVaultKey();
  for (const row of rows) {
    if (!isEncrypted(row.value)) {
      const encrypted = encrypt(row.value, vaultKey);
      d.prepare('UPDATE keys SET value = ? WHERE uid = ?').run(encrypted, row.uid);
    }
  }
}

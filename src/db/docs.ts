/** @fileoverview Doc persistence: CRUD, bindings, and system prompt assembly. */

import type { PaginatedResult, Binding } from './core.ts';
import { getDb, paginate, loadBindingsFor, replaceBindingsFor, DEFAULT_PER_PAGE } from './core.ts';
import { generateUid, UID_PREFIX } from '../core/uid.ts';

export interface DocRow {
  uid: string;
  title: string;
  content: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface DocInfo extends DocRow {
  bindings: Binding[];
}

const DOC_SORT_COLUMNS = new Set(['uid', 'title', 'pinned', 'created_at', 'updated_at']);
const DOC_SEARCH_COLUMNS = ['title', 'content'] as const;

export function listDocs(
  page = 1,
  perPage = DEFAULT_PER_PAGE,
  sort?: string,
  search?: string,
): PaginatedResult<DocInfo> {
  const result = paginate<DocRow>('docs', page, perPage, {
    defaultSort: 'pinned DESC, created_at ASC',
    sort,
    search,
    allowedSortColumns: DOC_SORT_COLUMNS,
    searchColumns: DOC_SEARCH_COLUMNS,
  });
  const uids = result.items.map((r) => r.uid);
  const bindingsMap = loadBindingsFor('doc_bindings', 'doc_uid', uids);
  return {
    ...result,
    items: result.items.map((row) => ({
      ...row,
      bindings: bindingsMap.get(row.uid) ?? [],
    })),
  };
}

export function getDoc(uid: string): DocRow | undefined {
  const d = getDb();
  return d.prepare('SELECT * FROM docs WHERE uid = ?').get(uid) as unknown as DocRow | undefined;
}

export function getDocBindings(uid: string): Binding[] {
  const d = getDb();
  const rows = d
    .prepare('SELECT target_type, target_id FROM doc_bindings WHERE doc_uid = ?')
    .all(uid) as unknown as Array<{ target_type: 'channel' | 'bird'; target_id: string }>;
  return rows.map((b) => ({ targetType: b.target_type, targetId: b.target_id }));
}

export function getDocInfo(uid: string): DocInfo | undefined {
  const row = getDoc(uid);
  if (!row) return undefined;
  return { ...row, bindings: getDocBindings(uid) };
}

export function docRowToInfo(row: DocRow): DocInfo {
  return { ...row, bindings: getDocBindings(row.uid) };
}

export function createDoc(title: string, content?: string): DocRow {
  const d = getDb();
  const uid = generateUid(UID_PREFIX.doc);
  d.prepare('INSERT INTO docs (uid, title, content) VALUES (?, ?, ?)').run(
    uid,
    title,
    content ?? '',
  );
  return getDoc(uid)!;
}

export function updateDoc(
  uid: string,
  fields: { title?: string; content?: string; pinned?: number },
): DocRow | undefined {
  const d = getDb();
  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (fields.title !== undefined) {
    sets.push('title = ?');
    params.push(fields.title);
  }
  if (fields.content !== undefined) {
    sets.push('content = ?');
    params.push(fields.content);
  }
  if (fields.pinned !== undefined) {
    sets.push('pinned = ?');
    params.push(fields.pinned);
  }

  if (sets.length === 0) return getDoc(uid);

  sets.push("updated_at = datetime('now')");
  params.push(uid);

  const result = d.prepare(`UPDATE docs SET ${sets.join(', ')} WHERE uid = ?`).run(...params);
  if (result.changes === 0) return undefined;
  return getDoc(uid);
}

export function deleteDoc(uid: string): boolean {
  const d = getDb();
  const result = d.prepare('DELETE FROM docs WHERE uid = ?').run(uid);
  return result.changes > 0;
}

export function setDocPinned(uid: string, pinned: boolean): DocRow | undefined {
  return updateDoc(uid, { pinned: pinned ? 1 : 0 });
}

export function replaceDocBindings(docUid: string, bindings: Binding[]): void {
  replaceBindingsFor('doc_bindings', 'doc_uid', docUid, bindings);
}

/**
 * Returns concatenated content of all docs that match the given targets.
 * A doc matches if it has no bindings (global) or if any of its bindings match a target.
 * When no targets are provided, only global (unbound) docs are included.
 */
export function getDocsSystemPrompt(
  targets?: Array<{ type: 'channel' | 'bird'; id: string }>,
): string {
  const d = getDb();

  let rows: Array<{ uid: string; title: string; content: string }>;

  if (!targets || targets.length === 0) {
    rows = d
      .prepare(
        `SELECT d.uid, d.title, d.content FROM docs d
         WHERE NOT EXISTS (SELECT 1 FROM doc_bindings db WHERE db.doc_uid = d.uid)
         ORDER BY d.pinned DESC, d.created_at ASC`,
      )
      .all() as unknown as Array<{ uid: string; title: string; content: string }>;
  } else {
    const placeholders = targets.map(() => '(?, ?)').join(', ');
    const targetParams = targets.flatMap((t) => [t.type, t.id]);

    rows = d
      .prepare(
        `SELECT DISTINCT d.uid, d.title, d.content, d.pinned, d.created_at FROM docs d
         WHERE NOT EXISTS (SELECT 1 FROM doc_bindings db WHERE db.doc_uid = d.uid)
            OR EXISTS (
              SELECT 1 FROM doc_bindings db
              WHERE db.doc_uid = d.uid
                AND (db.target_type, db.target_id) IN (VALUES ${placeholders})
            )
         ORDER BY d.pinned DESC, d.created_at ASC`,
      )
      .all(...targetParams) as unknown as Array<{
      uid: string;
      title: string;
      content: string;
    }>;
  }

  if (rows.length === 0) return '';

  return rows.map((r) => `## ${r.title}\n\n${r.content}`).join('\n\n---\n\n');
}

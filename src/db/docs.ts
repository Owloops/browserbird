/** @fileoverview Doc persistence: file-backed markdown docs with db metadata and bindings. */

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  existsSync,
  watch,
} from 'node:fs';
import { resolve, basename, extname, join } from 'node:path';
import type { PaginatedResult, Binding } from './core.ts';
import { getDb, paginate, loadBindingsFor, replaceBindingsFor, DEFAULT_PER_PAGE } from './core.ts';
import { generateUid, UID_PREFIX } from '../core/uid.ts';
import { logger } from '../core/logger.ts';

const DOCS_DIR = resolve('.browserbird', 'docs');

export function getDocsDir(): string {
  return DOCS_DIR;
}

export interface DocRow {
  uid: string;
  title: string;
  file_path: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface DocInfo extends DocRow {
  content: string;
  bindings: Binding[];
}

const DOC_SORT_COLUMNS = new Set(['uid', 'title', 'pinned', 'created_at', 'updated_at']);
const DOC_SEARCH_COLUMNS = ['title'] as const;

function readDocFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function toDocInfo(row: DocRow, bindings: Binding[]): DocInfo {
  return { ...row, content: readDocFile(row.file_path), bindings };
}

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
    items: result.items.map((row) => toDocInfo(row, bindingsMap.get(row.uid) ?? [])),
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
  return toDocInfo(row, getDocBindings(uid));
}

export function docRowToInfo(row: DocRow): DocInfo {
  return toDocInfo(row, getDocBindings(row.uid));
}

function ensureDocsDir(): void {
  mkdirSync(DOCS_DIR, { recursive: true });
}

function titleToFilename(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

function uniqueFilePath(title: string): string {
  ensureDocsDir();
  const base = titleToFilename(title);
  let candidate = join(DOCS_DIR, `${base}.md`);
  let i = 1;
  while (existsSync(candidate)) {
    candidate = join(DOCS_DIR, `${base}-${i}.md`);
    i++;
  }
  return candidate;
}

export function createDoc(title: string, content?: string): DocInfo {
  const d = getDb();
  const uid = generateUid(UID_PREFIX.doc);
  const filePath = uniqueFilePath(title);
  writeFileSync(filePath, content ?? '', 'utf-8');
  d.prepare('INSERT INTO docs (uid, title, file_path) VALUES (?, ?, ?)').run(uid, title, filePath);
  return getDocInfo(uid)!;
}

export function updateDoc(
  uid: string,
  fields: { title?: string; content?: string; pinned?: number },
): DocInfo | undefined {
  const row = getDoc(uid);
  if (!row) return undefined;

  if (fields.content !== undefined) {
    writeFileSync(row.file_path, fields.content, 'utf-8');
  }

  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (fields.title !== undefined) {
    sets.push('title = ?');
    params.push(fields.title);
  }
  if (fields.pinned !== undefined) {
    sets.push('pinned = ?');
    params.push(fields.pinned);
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    params.push(uid);
    getDb()
      .prepare(`UPDATE docs SET ${sets.join(', ')} WHERE uid = ?`)
      .run(...params);
  } else if (fields.content !== undefined) {
    getDb().prepare("UPDATE docs SET updated_at = datetime('now') WHERE uid = ?").run(uid);
  }

  return getDocInfo(uid);
}

export function deleteDoc(uid: string): boolean {
  const row = getDoc(uid);
  if (!row) return false;
  const d = getDb();
  d.prepare('DELETE FROM docs WHERE uid = ?').run(uid);
  try {
    unlinkSync(row.file_path);
  } catch {
    // file may already be gone
  }
  return true;
}

export function setDocPinned(uid: string, pinned: boolean): DocInfo | undefined {
  return updateDoc(uid, { pinned: pinned ? 1 : 0 });
}

export function replaceDocBindings(docUid: string, bindings: Binding[]): void {
  replaceBindingsFor('doc_bindings', 'doc_uid', docUid, bindings);
}

/**
 * Scans the docs directory for .md files and syncs with the database.
 * New files get a db row; db rows whose files no longer exist get removed.
 * Returns true if any changes were made.
 */
export function syncDocs(): boolean {
  ensureDocsDir();
  const d = getDb();
  let changed = false;

  const existingRows = d.prepare('SELECT uid, file_path FROM docs').all() as unknown as Array<{
    uid: string;
    file_path: string;
  }>;
  const dbByPath = new Map(existingRows.map((r) => [r.file_path, r.uid]));

  let filesOnDisk: string[];
  try {
    filesOnDisk = readdirSync(DOCS_DIR)
      .filter((f) => extname(f) === '.md')
      .map((f) => join(DOCS_DIR, f));
  } catch {
    return false;
  }

  const diskPaths = new Set(filesOnDisk);

  for (const filePath of filesOnDisk) {
    if (!dbByPath.has(filePath)) {
      const uid = generateUid(UID_PREFIX.doc);
      const name = basename(filePath, '.md');
      d.prepare('INSERT INTO docs (uid, title, file_path) VALUES (?, ?, ?)').run(
        uid,
        name,
        filePath,
      );
      logger.info(`docs: discovered ${name}`);
      changed = true;
    }
  }

  for (const [filePath, uid] of dbByPath) {
    if (!diskPaths.has(filePath)) {
      d.prepare('DELETE FROM docs WHERE uid = ?').run(uid);
      logger.info(`docs: removed missing file ${basename(filePath)}`);
      changed = true;
    }
  }

  return changed;
}

/**
 * Watches the docs directory for any file changes (add, remove, modify).
 * Runs syncDocs on structural changes and always broadcasts so the UI
 * picks up content edits too.
 */
export function watchDocs(onchange: () => void): () => void {
  ensureDocsDir();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(DOCS_DIR, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      syncDocs();
      onchange();
    }, 500);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
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

  let rows: Array<{ uid: string; title: string; file_path: string }>;

  if (!targets || targets.length === 0) {
    rows = d
      .prepare(
        `SELECT d.uid, d.title, d.file_path FROM docs d
         WHERE NOT EXISTS (SELECT 1 FROM doc_bindings db WHERE db.doc_uid = d.uid)
         ORDER BY d.pinned DESC, d.created_at ASC`,
      )
      .all() as unknown as Array<{ uid: string; title: string; file_path: string }>;
  } else {
    const placeholders = targets.map(() => '(?, ?)').join(', ');
    const targetParams = targets.flatMap((t) => [t.type, t.id]);

    rows = d
      .prepare(
        `SELECT DISTINCT d.uid, d.title, d.file_path, d.pinned, d.created_at FROM docs d
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
      file_path: string;
    }>;
  }

  if (rows.length === 0) return '';

  return rows
    .map((r) => {
      const content = readDocFile(r.file_path);
      return content ? `## ${r.title}\n\n${content}` : '';
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

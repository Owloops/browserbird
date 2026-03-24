/** @fileoverview Docs command: manage markdown documents for agent system prompts. */

import { parseArgs } from 'node:util';
import { basename } from 'node:path';
import { logger } from '../core/logger.ts';
import { shortUid } from '../core/uid.ts';
import { printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import {
  openDatabase,
  closeDatabase,
  getDb,
  resolveByUid,
  resolveDbPathFromArgv,
  listDocs,
  createDoc,
  deleteDoc,
  syncDocs,
  replaceDocBindings,
  getDocBindings,
} from '../db/index.ts';
import type { DocRow } from '../db/docs.ts';

export const DOCS_HELP = `
${c('cyan', 'usage:')} browserbird docs <subcommand> [options]

manage markdown documents injected into agent system prompts.

${c('dim', 'subcommands:')}

  ${c('cyan', 'list')}                          list all docs
  ${c('cyan', 'add')} <title>                   create a new doc
  ${c('cyan', 'remove')} <uid|title>            remove a doc and its file
  ${c('cyan', 'bind')} <uid|title> <type> <target>  bind a doc to a channel or bird
  ${c('cyan', 'unbind')} <uid|title> <type> <target>  unbind a doc from a target
  ${c('cyan', 'sync')}                          scan docs directory for new or removed files

${c('dim', 'options:')}

  ${c('yellow', '--content')} <text>    initial content (with add)
  ${c('yellow', '--json')}             output as JSON (with list)
  ${c('yellow', '--db')} <path>         database file path (env: BROWSERBIRD_DB)
  ${c('yellow', '-h, --help')}          show this help

${c('dim', 'docs are stored as .md files in .browserbird/docs/.')}
${c('dim', 'edit them directly with any text editor.')}
${c('dim', "docs with no bindings are not injected. bind to channel '*' for global.")}
`.trim();

function resolveDoc(nameOrUid: string): DocRow | undefined {
  const d = getDb();
  const byTitle = d.prepare('SELECT * FROM docs WHERE title = ?').get(nameOrUid) as unknown as
    | DocRow
    | undefined;
  if (byTitle) return byTitle;
  const result = resolveByUid<DocRow>('docs', nameOrUid);
  if (!result) {
    logger.error(`doc "${nameOrUid}" not found`);
    process.exitCode = 1;
    return undefined;
  }
  if ('ambiguous' in result) {
    logger.error(
      `ambiguous doc ID "${nameOrUid}" matches ${result.count} docs, use a longer prefix`,
    );
    process.exitCode = 1;
    return undefined;
  }
  return result.row;
}

export function handleDocs(argv: string[]): void {
  const subcommand = argv[0] ?? 'list';
  const rest = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      content: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  openDatabase(resolveDbPathFromArgv(argv));

  try {
    switch (subcommand) {
      case 'list': {
        syncDocs();
        const result = listDocs(1, 100);
        if (values.json) {
          console.log(JSON.stringify(result.items, null, 2));
          break;
        }
        console.log(`docs (${result.totalItems} total):`);
        if (result.items.length === 0) {
          console.log('\n  no docs found');
          return;
        }
        console.log('');
        const rows = result.items.map((doc) => {
          const bindings =
            doc.bindings.map((b) => `${b.targetType}:${b.targetId}`).join(', ') || 'global';
          return [c('dim', shortUid(doc.uid)), doc.title, basename(doc.file_path), bindings];
        });
        printTable(['uid', 'title', 'file', 'scope'], rows, [undefined, 30, 30, 40]);
        break;
      }

      case 'add': {
        const title = positionals.join(' ').trim();
        if (!title) {
          logger.error('usage: browserbird docs add <title> [--content <text>]');
          process.exitCode = 1;
          return;
        }
        const doc = createDoc(title, (values.content as string | undefined) ?? '');
        logger.success(`doc "${doc.title}" created at ${basename(doc.file_path)}`);
        process.stderr.write(c('dim', `  path: ${doc.file_path}`) + '\n');
        break;
      }

      case 'remove': {
        const nameOrUid = positionals[0];
        if (!nameOrUid) {
          logger.error('usage: browserbird docs remove <uid|title>');
          process.exitCode = 1;
          return;
        }
        const doc = resolveDoc(nameOrUid);
        if (!doc) return;
        if (deleteDoc(doc.uid)) {
          logger.success(`doc "${doc.title}" removed`);
        } else {
          logger.error(`doc "${nameOrUid}" not found`);
          process.exitCode = 1;
        }
        break;
      }

      case 'bind': {
        const nameOrUid = positionals[0];
        const targetType = positionals[1] as 'channel' | 'bird' | undefined;
        const targetId = positionals[2];
        if (!nameOrUid || !targetType || !targetId) {
          logger.error(
            "usage: browserbird docs bind <uid|title> <channel|bird> <target>\n  example: browserbird docs bind tone-guide channel '*'",
          );
          process.exitCode = 1;
          return;
        }
        if (targetType !== 'channel' && targetType !== 'bird') {
          logger.error('target type must be "channel" or "bird"');
          process.exitCode = 1;
          return;
        }
        const doc = resolveDoc(nameOrUid);
        if (!doc) return;
        const existing = getDocBindings(doc.uid);
        if (existing.some((b) => b.targetType === targetType && b.targetId === targetId)) {
          logger.warn(`doc "${doc.title}" is already bound to ${targetType} ${targetId}`);
          return;
        }
        replaceDocBindings(doc.uid, [...existing, { targetType, targetId }]);
        logger.success(`doc "${doc.title}" bound to ${targetType} ${targetId}`);
        break;
      }

      case 'unbind': {
        const nameOrUid = positionals[0];
        const targetType = positionals[1] as 'channel' | 'bird' | undefined;
        const targetId = positionals[2];
        if (!nameOrUid || !targetType || !targetId) {
          logger.error('usage: browserbird docs unbind <uid|title> <channel|bird> <target>');
          process.exitCode = 1;
          return;
        }
        if (targetType !== 'channel' && targetType !== 'bird') {
          logger.error('target type must be "channel" or "bird"');
          process.exitCode = 1;
          return;
        }
        const doc = resolveDoc(nameOrUid);
        if (!doc) return;
        const existing = getDocBindings(doc.uid);
        const filtered = existing.filter(
          (b) => !(b.targetType === targetType && b.targetId === targetId),
        );
        if (filtered.length === existing.length) {
          logger.warn(`doc "${doc.title}" is not bound to ${targetType} ${targetId}`);
          return;
        }
        replaceDocBindings(doc.uid, filtered);
        logger.success(`doc "${doc.title}" unbound from ${targetType} ${targetId}`);
        break;
      }

      case 'sync': {
        const changed = syncDocs();
        if (changed) {
          logger.success('docs synced');
        } else {
          logger.info('docs already in sync');
        }
        break;
      }

      default:
        unknownSubcommand(subcommand, 'docs', ['list', 'add', 'remove', 'bind', 'unbind', 'sync']);
    }
  } finally {
    closeDatabase();
  }
}

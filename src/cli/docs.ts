/** @fileoverview Docs command: manage markdown documents for agent system prompts. */

import { parseArgs } from 'node:util';
import { basename } from 'node:path';
import { logger } from '../core/logger.ts';
import { shortUid } from '../core/uid.ts';
import { printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import type { DocInfo } from '../db/docs.ts';
import type { PaginatedResult } from '../db/index.ts';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

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
  ${c('yellow', '-h, --help')}          show this help

${c('dim', 'docs are stored as .md files in .browserbird/docs/.')}
${c('dim', 'edit them directly with any text editor.')}
${c('dim', "docs with no bindings are not injected. bind to channel '*' for global.")}
`.trim();

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

async function resolveDoc(nameOrUid: string): Promise<DocInfo | undefined> {
  const result = await runDaemonCall<PaginatedResult<DocInfo>>(() =>
    daemonRequest<PaginatedResult<DocInfo>>({
      method: 'GET',
      path: '/api/docs?perPage=1000',
    }),
  );
  if (!result) return undefined;
  const byTitle = result.items.find((d) => d.title === nameOrUid);
  if (byTitle) return byTitle;
  const byUid = result.items.find((d) => d.uid === nameOrUid || d.uid.startsWith(nameOrUid));
  if (byUid) return byUid;
  logger.error(`doc "${nameOrUid}" not found`);
  process.exitCode = 1;
  return undefined;
}

export async function handleDocs(argv: string[]): Promise<void> {
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

  switch (subcommand) {
    case 'list': {
      const result = await runDaemonCall<PaginatedResult<DocInfo>>(() =>
        daemonRequest<PaginatedResult<DocInfo>>({
          method: 'GET',
          path: '/api/docs?perPage=100',
        }),
      );
      if (!result) return;
      if (values.json) {
        console.log(JSON.stringify(result.items, null, 2));
        return;
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
      return;
    }

    case 'add': {
      const title = positionals.join(' ').trim();
      if (!title) {
        logger.error('usage: browserbird docs add <title> [--content <text>]');
        process.exitCode = 1;
        return;
      }
      const doc = await runDaemonCall<DocInfo>(() =>
        daemonRequest<DocInfo>({
          method: 'POST',
          path: '/api/docs',
          body: { title, content: (values.content as string | undefined) ?? '' },
        }),
      );
      if (!doc) return;
      logger.success(`doc "${doc.title}" created at ${basename(doc.file_path)}`);
      process.stderr.write(c('dim', `  path: ${doc.file_path}`) + '\n');
      return;
    }

    case 'remove': {
      const nameOrUid = positionals[0];
      if (!nameOrUid) {
        logger.error('usage: browserbird docs remove <uid|title>');
        process.exitCode = 1;
        return;
      }
      const doc = await resolveDoc(nameOrUid);
      if (!doc) return;
      const removed = await runDaemonCall(() =>
        daemonRequest<{ success?: boolean }>({
          method: 'DELETE',
          path: `/api/docs/${doc.uid}`,
        }),
      );
      if (removed === undefined) return;
      logger.success(`doc "${doc.title}" removed`);
      return;
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
      const doc = await resolveDoc(nameOrUid);
      if (!doc) return;
      if (doc.bindings.some((b) => b.targetType === targetType && b.targetId === targetId)) {
        logger.warn(`doc "${doc.title}" is already bound to ${targetType} ${targetId}`);
        return;
      }
      const bindResult = await runDaemonCall(() =>
        daemonRequest<{ success?: boolean }>({
          method: 'PUT',
          path: `/api/docs/${doc.uid}/bindings`,
          body: [...doc.bindings, { targetType, targetId }],
        }),
      );
      if (bindResult === undefined) return;
      logger.success(`doc "${doc.title}" bound to ${targetType} ${targetId}`);
      return;
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
      const doc = await resolveDoc(nameOrUid);
      if (!doc) return;
      const filtered = doc.bindings.filter(
        (b) => !(b.targetType === targetType && b.targetId === targetId),
      );
      if (filtered.length === doc.bindings.length) {
        logger.warn(`doc "${doc.title}" is not bound to ${targetType} ${targetId}`);
        return;
      }
      const unbindResult = await runDaemonCall(() =>
        daemonRequest<{ success?: boolean }>({
          method: 'PUT',
          path: `/api/docs/${doc.uid}/bindings`,
          body: filtered,
        }),
      );
      if (unbindResult === undefined) return;
      logger.success(`doc "${doc.title}" unbound from ${targetType} ${targetId}`);
      return;
    }

    case 'sync': {
      const result = await runDaemonCall<{ changed: boolean }>(() =>
        daemonRequest<{ changed: boolean }>({
          method: 'POST',
          path: '/api/docs/sync',
        }),
      );
      if (!result) return;
      if (result.changed) {
        logger.success('docs synced');
      } else {
        logger.info('docs already in sync');
      }
      return;
    }

    default:
      unknownSubcommand(subcommand, 'docs', ['list', 'add', 'remove', 'bind', 'unbind', 'sync']);
  }
}

/** @fileoverview Sessions command: list and inspect sessions. */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { logger } from '../core/logger.ts';
import { shortUid } from '../core/uid.ts';
import { printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import {
  openDatabase,
  closeDatabase,
  resolveByUid,
  listSessions,
  getSessionMessages,
  getSessionTokenStats,
} from '../db/index.ts';
import type { SessionRow } from '../db/index.ts';

export const SESSIONS_HELP = `
${c('cyan', 'usage:')} browserbird sessions <subcommand> [options]

manage sessions.

${c('dim', 'subcommands:')}

  ${c('cyan', 'list')}          list recent sessions
  ${c('cyan', 'logs')} <uid>    show session detail and message history

${c('dim', 'options:')}

  ${c('yellow', '-h, --help')}   show this help
`.trim();

export function handleSessions(argv: string[]): void {
  const subcommand = argv[0] ?? 'list';
  const args = argv.slice(1);

  const dbPath = resolve('.browserbird', 'browserbird.db');

  if (subcommand === 'list') {
    openDatabase(dbPath);
    try {
      const { items, totalItems } = listSessions(1, 20);
      console.log(`sessions (${totalItems} total):`);
      if (items.length === 0) {
        console.log('\n  no sessions found');
        return;
      }
      console.log('');
      const rows = items.map((s) => [
        c('dim', shortUid(s.uid)),
        s.channel_id,
        s.agent_id,
        String(s.message_count),
        s.last_active.slice(0, 19),
      ]);
      printTable(['uid', 'channel', 'agent', 'messages', 'last active'], rows);
    } finally {
      closeDatabase();
    }
    return;
  }

  if (subcommand !== 'logs') {
    unknownSubcommand(subcommand, 'sessions');
    return;
  }

  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
    strict: false,
  });

  const uidPrefix = positionals[0];
  if (!uidPrefix) {
    logger.error('usage: browserbird sessions logs <uid>');
    process.exitCode = 1;
    return;
  }

  openDatabase(dbPath);

  try {
    const result = resolveByUid<SessionRow>('sessions', uidPrefix);
    if (!result) {
      logger.error(`session ${uidPrefix} not found`);
      process.exitCode = 1;
      return;
    }
    if ('ambiguous' in result) {
      logger.error(
        `ambiguous session ID "${uidPrefix}" matches ${result.count} sessions, use a longer prefix`,
      );
      process.exitCode = 1;
      return;
    }
    const session = result.row;

    const tokenStats = getSessionTokenStats(session.channel_id, session.thread_id);

    console.log(`session ${c('cyan', shortUid(session.uid))}`);
    console.log(c('dim', '------------------'));
    console.log(`${c('dim', 'uid:')}          ${session.uid}`);
    console.log(`${c('dim', 'channel:')}      ${session.channel_id}`);
    console.log(`${c('dim', 'thread:')}       ${session.thread_id ?? '(none)'}`);
    console.log(`${c('dim', 'agent:')}        ${session.agent_id}`);
    console.log(`${c('dim', 'provider id:')}  ${session.provider_session_id}`);
    console.log(`${c('dim', 'created:')}      ${session.created_at}`);
    console.log(`${c('dim', 'last active:')}  ${session.last_active}`);
    console.log(`${c('dim', 'messages:')}     ${session.message_count}`);
    console.log(
      `${c('dim', 'tokens:')}       ${tokenStats.totalTokensIn} in / ${tokenStats.totalTokensOut} out`,
    );
    console.log('');

    const msgResult = getSessionMessages(session.channel_id, session.thread_id, 1, 50);

    if (msgResult.items.length === 0) {
      console.log('no messages recorded.');
      return;
    }

    console.log(
      `messages (${msgResult.totalItems} total, showing page 1 of ${msgResult.totalPages}):`,
    );
    console.log('------------------');

    for (const msg of msgResult.items) {
      const dir = msg.direction === 'in' ? c('green', '->') : c('cyan', '<-');
      const tokens =
        msg.tokens_in != null || msg.tokens_out != null
          ? `  [in:${msg.tokens_in ?? 0} out:${msg.tokens_out ?? 0}]`
          : '';
      const preview = (msg.content ?? '').slice(0, 120);
      const truncated = (msg.content?.length ?? 0) > 120 ? '...' : '';
      console.log(`${dir} ${msg.user_id}  ${msg.created_at}${tokens}`);
      if (preview) console.log(`   ${preview}${truncated}`);
    }
  } finally {
    closeDatabase();
  }
}

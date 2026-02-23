/** @fileoverview Sessions command — list and inspect claude sessions. */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { logger } from '../core/logger.ts';
import { printTable, unknownSubcommand } from '../core/table.ts';
import {
  openDatabase,
  closeDatabase,
  listSessions,
  getSession,
  getSessionMessages,
  getSessionTokenStats,
} from '../db/index.ts';

export const SESSIONS_HELP = `
usage: browserbird sessions <subcommand> [options]

manage claude sessions.

subcommands:

  list          list recent sessions
  logs <id>     show session detail and message history

options:

  -h, --help   show this help
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
        String(s.id),
        s.channel_id,
        s.agent_id,
        String(s.message_count),
        s.last_active.slice(0, 19),
      ]);
      printTable(['id', 'channel', 'agent', 'messages', 'last active'], rows);
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

  const id = Number(positionals[0]);
  if (!Number.isFinite(id)) {
    logger.error('usage: browserbird sessions logs <id>');
    process.exitCode = 1;
    return;
  }

  openDatabase(dbPath);

  try {
    const session = getSession(id);
    if (!session) {
      logger.error(`session #${id} not found`);
      process.exitCode = 1;
      return;
    }

    const tokenStats = getSessionTokenStats(session.channel_id, session.thread_id);

    console.log(`session #${id}`);
    console.log('------------------');
    console.log(`channel:      ${session.channel_id}`);
    console.log(`thread:       ${session.thread_id ?? '(none)'}`);
    console.log(`agent:        ${session.agent_id}`);
    console.log(`provider id:  ${session.provider_session_id}`);
    console.log(`created:      ${session.created_at}`);
    console.log(`last active:  ${session.last_active}`);
    console.log(`messages:     ${session.message_count}`);
    console.log(`tokens:       ${tokenStats.totalTokensIn} in / ${tokenStats.totalTokensOut} out`);
    console.log('');

    const result = getSessionMessages(session.channel_id, session.thread_id, 1, 50);

    if (result.items.length === 0) {
      console.log('no messages recorded.');
      return;
    }

    console.log(`messages (${result.totalItems} total, showing page 1 of ${result.totalPages}):`);
    console.log('------------------');

    for (const msg of result.items) {
      const dir = msg.direction === 'in' ? '->' : '<-';
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

/** @fileoverview Sessions command: list, inspect, and chat with agent sessions. */

import { parseArgs } from 'node:util';
import { logger } from '../core/logger.ts';
import { shortUid } from '../core/uid.ts';
import { printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import { runChat } from './chat.ts';
import type { SessionRow, MessageRow, PaginatedResult } from '../db/index.ts';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

interface SessionTokenStats {
  totalTokensIn: number;
  totalTokensOut: number;
}

interface SessionDetailResponse {
  session: SessionRow;
  messages: PaginatedResult<MessageRow>;
  stats: SessionTokenStats;
}

export const SESSIONS_HELP = `
${c('cyan', 'usage:')} browserbird sessions <subcommand> [options]

manage sessions and chat with the agent.

${c('dim', 'subcommands:')}

  ${c('cyan', 'list')}                    list recent sessions
  ${c('cyan', 'logs')} <uid>              show session detail and message history
  ${c('cyan', 'chat')} <message>          send a message and stream the response

${c('dim', 'options:')}

  ${c('yellow', '--session')} <uid>  resume an existing session (with chat)
  ${c('yellow', '--agent')} <id>    agent id, default "default" (with chat)
  ${c('yellow', '--json')}          output as JSON (with list, logs)
  ${c('yellow', '-h, --help')}      show this help

${c('dim', 'examples:')}

  browserbird sessions chat "summarize today's logs"
  browserbird sessions chat --session ss_abc1234 "follow up on that"
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

export async function handleSessions(argv: string[]): Promise<void> {
  const subcommand = argv[0] ?? 'list';
  const args = argv.slice(1);

  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', default: false },
      session: { type: 'string' },
      agent: { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  switch (subcommand) {
    case 'list': {
      const result = await runDaemonCall<PaginatedResult<SessionRow & { message_count: number }>>(
        () =>
          daemonRequest<PaginatedResult<SessionRow & { message_count: number }>>({
            method: 'GET',
            path: '/api/sessions?perPage=20',
          }),
      );
      if (!result) return;
      const { items, totalItems } = result;
      if (values.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
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
      return;
    }

    case 'logs': {
      const uidPrefix = positionals[0];
      if (!uidPrefix) {
        logger.error('usage: browserbird sessions logs <uid>');
        process.exitCode = 1;
        return;
      }
      const detail = await runDaemonCall<SessionDetailResponse>(() =>
        daemonRequest<SessionDetailResponse>({
          method: 'GET',
          path: `/api/sessions/${uidPrefix}?perPage=50`,
        }),
      );
      if (!detail) return;
      const { session, messages: msgResult, stats: tokenStats } = detail;

      if (values.json) {
        console.log(JSON.stringify({ session, messages: msgResult.items }, null, 2));
        return;
      }

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
      return;
    }

    case 'chat': {
      const message = positionals.join(' ').trim();
      if (!message) {
        logger.error('usage: browserbird sessions chat <message> [--session <uid>] [--agent <id>]');
        process.exitCode = 1;
        return;
      }
      await runChat(message, {
        session: values.session as string | undefined,
        agent: values.agent as string | undefined,
      });
      return;
    }

    default:
      unknownSubcommand(subcommand, 'sessions', ['list', 'logs', 'chat']);
  }
}

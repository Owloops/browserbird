/** @fileoverview Chat subcommand: send a message to the agent and stream the response. */

import { resolve, dirname } from 'node:path';
import { logger } from '../core/logger.ts';
import { c } from './style.ts';
import { loadConfig, loadDotEnv, DEFAULT_CONFIG_PATH } from '../config.ts';
import { getSession, createSession, touchSession } from '../db/index.ts';
import { getDocsSystemPrompt } from '../db/docs.ts';
import { resolveExtraEnv } from '../db/keys.ts';
import { spawnProvider } from '../provider/spawn.ts';

export async function runChat(
  message: string,
  options: { session?: string; agent?: string },
): Promise<void> {
  const configPath = process.env['BROWSERBIRD_CONFIG']
    ? resolve(process.env['BROWSERBIRD_CONFIG'])
    : DEFAULT_CONFIG_PATH;
  const envPath = resolve(dirname(configPath), '.env');
  loadDotEnv(envPath);

  const config = loadConfig(configPath);
  const agentId = options.agent ?? 'default';
  const agent = config.agents.find((a) => a.id === agentId);
  if (!agent) {
    logger.error(`agent "${agentId}" not found in config`);
    process.exitCode = 1;
    return;
  }

  let sessionId: string | undefined;
  if (options.session) {
    const session = getSession(options.session);
    if (!session) {
      logger.error(`session ${options.session} not found`);
      process.exitCode = 1;
      return;
    }
    sessionId = session.provider_session_id || undefined;
    touchSession(session.uid, session.message_count + 1);
  }

  const targets: Array<{ type: 'channel' | 'bird'; id: string }> = [{ type: 'channel', id: 'cli' }];
  const extraEnv = resolveExtraEnv(targets);
  const docsPrompt = getDocsSystemPrompt(targets);

  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());

  const { events } = spawnProvider(
    {
      message,
      sessionId,
      agent,
      mcpConfigPath: config.browser.mcpConfigPath,
      timezone: config.timezone,
      globalTimeoutMs: config.sessions.processTimeoutMs,
      extraEnv,
      docsPrompt,
    },
    ac.signal,
  );

  let newSessionId: string | undefined;

  for await (const event of events) {
    switch (event.type) {
      case 'text_delta':
        process.stdout.write(event.delta);
        break;
      case 'init':
        newSessionId = event.sessionId;
        break;
      case 'completion':
        if (!options.session && newSessionId) {
          const session = createSession('cli', `cli_${Date.now()}`, agentId, newSessionId);
          process.stderr.write('\n' + c('dim', `session: ${session.uid}`) + '\n');
        }
        break;
      case 'error':
        process.stderr.write(c('red', `\nerror: ${event.error}`) + '\n');
        process.exitCode = 1;
        break;
      case 'timeout':
        process.stderr.write(c('red', '\nerror: agent timed out') + '\n');
        process.exitCode = 1;
        break;
    }
  }

  process.stdout.write('\n');
}

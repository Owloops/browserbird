/** @fileoverview Keys command: manage vault keys for agent sessions. */

import { parseArgs } from 'node:util';
import { logger } from '../core/logger.ts';
import { printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import { promptSecret } from './prompt.ts';
import type { KeyInfo, KeyBinding } from '../db/keys.ts';
import type { PaginatedResult } from '../db/index.ts';
import {
  daemonRequest,
  DaemonAuthError,
  DaemonError,
  DaemonUnreachableError,
} from './daemon-rpc.ts';

export const KEYS_HELP = `
${c('cyan', 'usage:')} browserbird keys <subcommand> [options]

manage vault keys (env vars injected into agent sessions).

${c('dim', 'subcommands:')}

  ${c('cyan', 'list')}                         list all keys
  ${c('cyan', 'add')} <name>                   add a new key (prompts for value)
  ${c('cyan', 'edit')} <name>                  update a key's value or description
  ${c('cyan', 'remove')} <name>                remove a key
  ${c('cyan', 'bind')} <name> <type> <target>  bind a key to a channel or bird
  ${c('cyan', 'unbind')} <name> <type> <target>  unbind a key from a target

${c('dim', 'options:')}

  ${c('yellow', '--value')} <secret>     secret value (if omitted, prompts interactively)
  ${c('yellow', '--description')} <text> description for the key
  ${c('yellow', '--json')}              output as JSON (with list)
  ${c('yellow', '-h, --help')}           show this help

${c('dim', 'examples:')}

  browserbird keys add GITHUB_TOKEN
  browserbird keys add GITHUB_TOKEN --value ghp_abc123
  browserbird keys bind GITHUB_TOKEN channel '*'
  browserbird keys bind GITHUB_TOKEN bird br_abc1234
  browserbird keys unbind GITHUB_TOKEN channel '*'
  browserbird keys remove GITHUB_TOKEN
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

async function resolveKey(nameOrUid: string): Promise<KeyInfo | undefined> {
  const result = await runDaemonCall<PaginatedResult<KeyInfo>>(() =>
    daemonRequest<PaginatedResult<KeyInfo>>({
      method: 'GET',
      path: '/api/keys?perPage=1000',
    }),
  );
  if (!result) return undefined;
  const upper = nameOrUid.trim().toUpperCase();
  const byName = result.items.find((k) => k.name === upper);
  if (byName) return byName;
  const byUid = result.items.find((k) => k.uid === nameOrUid || k.uid.startsWith(nameOrUid));
  if (byUid) return byUid;
  logger.error(`key "${nameOrUid}" not found`);
  process.exitCode = 1;
  return undefined;
}

export async function handleKeys(argv: string[]): Promise<void> {
  const subcommand = argv[0] ?? 'list';
  const rest = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      value: { type: 'string' },
      description: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  switch (subcommand) {
    case 'list': {
      const result = await runDaemonCall<PaginatedResult<KeyInfo>>(() =>
        daemonRequest<PaginatedResult<KeyInfo>>({
          method: 'GET',
          path: '/api/keys?perPage=100',
        }),
      );
      if (!result) return;
      if (values.json) {
        console.log(JSON.stringify(result.items, null, 2));
        return;
      }
      console.log(`keys (${result.totalItems} total):`);
      if (result.items.length === 0) {
        console.log('\n  no keys stored');
        return;
      }
      console.log('');
      const rows = result.items.map((key) => {
        const bindings = key.bindings.map((b) => `${b.targetType}:${b.targetId}`).join(', ') || '-';
        return [key.name, key.hint, key.description ?? '-', bindings];
      });
      printTable(['name', 'value', 'description', 'bindings'], rows, [
        undefined,
        undefined,
        30,
        40,
      ]);
      return;
    }

    case 'add': {
      const rawName = positionals[0];
      if (!rawName) {
        logger.error(
          'usage: browserbird keys add <name> [--value <secret>] [--description <text>]',
        );
        process.exitCode = 1;
        return;
      }
      const name = rawName.trim().toUpperCase();
      let secret = values.value as string | undefined;
      if (!secret) {
        secret = await promptSecret(`value for ${name}: `);
        if (!secret) {
          logger.error('value cannot be empty');
          process.exitCode = 1;
          return;
        }
      }
      const created = await runDaemonCall<{ uid: string }>(() =>
        daemonRequest<{ uid: string }>({
          method: 'POST',
          path: '/api/keys',
          body: {
            name,
            value: secret,
            description: (values.description as string | undefined)?.trim(),
          },
        }),
      );
      if (!created) return;
      logger.success(`key ${name} created`);
      process.stderr.write(
        c('dim', `  hint: run 'browserbird keys bind ${name} channel *' to bind it`) + '\n',
      );
      return;
    }

    case 'edit': {
      const nameOrUid = positionals[0];
      if (!nameOrUid) {
        logger.error(
          'usage: browserbird keys edit <name> [--value <secret>] [--description <text>]',
        );
        process.exitCode = 1;
        return;
      }
      const key = await resolveKey(nameOrUid);
      if (!key) return;
      const fields: { value?: string; description?: string } = {};
      if (values.value !== undefined) {
        fields.value = values.value as string;
      }
      if (values.description !== undefined) {
        fields.description = (values.description as string).trim();
      }
      if (!fields.value && !('description' in fields)) {
        const secret = await promptSecret(`new value for ${key.name}: `);
        if (secret) fields.value = secret;
      }
      if (!fields.value && !('description' in fields)) {
        logger.error('provide --value, --description, or enter a value when prompted');
        process.exitCode = 1;
        return;
      }
      const updated = await runDaemonCall<{ uid: string }>(() =>
        daemonRequest<{ uid: string }>({
          method: 'PATCH',
          path: `/api/keys/${key.uid}`,
          body: fields,
        }),
      );
      if (!updated) return;
      logger.success(`key ${key.name} updated`);
      return;
    }

    case 'remove': {
      const nameOrUid = positionals[0];
      if (!nameOrUid) {
        logger.error('usage: browserbird keys remove <name>');
        process.exitCode = 1;
        return;
      }
      const key = await resolveKey(nameOrUid);
      if (!key) return;
      const removed = await runDaemonCall(() =>
        daemonRequest<{ success?: boolean }>({
          method: 'DELETE',
          path: `/api/keys/${key.uid}`,
        }),
      );
      if (removed === undefined) return;
      logger.success(`key ${key.name} removed`);
      return;
    }

    case 'bind': {
      const nameOrUid = positionals[0];
      const targetType = positionals[1] as 'channel' | 'bird' | undefined;
      const targetId = positionals[2];
      if (!nameOrUid || !targetType || !targetId) {
        logger.error(
          "usage: browserbird keys bind <name> <channel|bird> <target>\n  example: browserbird keys bind GITHUB_TOKEN channel '*'",
        );
        process.exitCode = 1;
        return;
      }
      if (targetType !== 'channel' && targetType !== 'bird') {
        logger.error('target type must be "channel" or "bird"');
        process.exitCode = 1;
        return;
      }
      const key = await resolveKey(nameOrUid);
      if (!key) return;
      if (key.bindings.some((b) => b.targetType === targetType && b.targetId === targetId)) {
        logger.warn(`key ${key.name} is already bound to ${targetType} ${targetId}`);
        return;
      }
      const next: KeyBinding[] = [...key.bindings, { targetType, targetId }];
      const bindResult = await runDaemonCall(() =>
        daemonRequest<{ success?: boolean }>({
          method: 'PUT',
          path: `/api/keys/${key.uid}/bindings`,
          body: next,
        }),
      );
      if (bindResult === undefined) return;
      logger.success(`key ${key.name} bound to ${targetType} ${targetId}`);
      return;
    }

    case 'unbind': {
      const nameOrUid = positionals[0];
      const targetType = positionals[1] as 'channel' | 'bird' | undefined;
      const targetId = positionals[2];
      if (!nameOrUid || !targetType || !targetId) {
        logger.error('usage: browserbird keys unbind <name> <channel|bird> <target>');
        process.exitCode = 1;
        return;
      }
      if (targetType !== 'channel' && targetType !== 'bird') {
        logger.error('target type must be "channel" or "bird"');
        process.exitCode = 1;
        return;
      }
      const key = await resolveKey(nameOrUid);
      if (!key) return;
      const filtered = key.bindings.filter(
        (b) => !(b.targetType === targetType && b.targetId === targetId),
      );
      if (filtered.length === key.bindings.length) {
        logger.warn(`key ${key.name} is not bound to ${targetType} ${targetId}`);
        return;
      }
      const unbindResult = await runDaemonCall(() =>
        daemonRequest<{ success?: boolean }>({
          method: 'PUT',
          path: `/api/keys/${key.uid}/bindings`,
          body: filtered,
        }),
      );
      if (unbindResult === undefined) return;
      logger.success(`key ${key.name} unbound from ${targetType} ${targetId}`);
      return;
    }

    default:
      unknownSubcommand(subcommand, 'keys', ['list', 'add', 'edit', 'remove', 'bind', 'unbind']);
  }
}

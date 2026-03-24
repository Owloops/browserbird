/** @fileoverview Keys command: manage vault keys for agent sessions. */

import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { logger } from '../core/logger.ts';
import { printTable, unknownSubcommand } from '../core/utils.ts';
import { c } from './style.ts';
import { loadDotEnv, DEFAULT_CONFIG_PATH } from '../config.ts';
import { ensureVaultKey } from '../core/crypto.ts';
import {
  openDatabase,
  closeDatabase,
  getDb,
  resolveDbPathFromArgv,
  listKeys,
  createKey,
  updateKey,
  deleteKey,
  replaceBindings,
} from '../db/index.ts';
import type { KeyRow, KeyBinding } from '../db/keys.ts';
import { validateKeyName } from '../db/keys.ts';

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
  ${c('yellow', '--db')} <path>          database file path (env: BROWSERBIRD_DB)
  ${c('yellow', '-h, --help')}           show this help

${c('dim', 'examples:')}

  browserbird keys add GITHUB_TOKEN
  browserbird keys add GITHUB_TOKEN --value ghp_abc123
  browserbird keys bind GITHUB_TOKEN channel '*'
  browserbird keys bind GITHUB_TOKEN bird br_abc1234
  browserbird keys unbind GITHUB_TOKEN channel '*'
  browserbird keys remove GITHUB_TOKEN
`.trim();

function resolveKey(nameOrUid: string): KeyRow | undefined {
  const d = getDb();
  const byName = d
    .prepare('SELECT * FROM keys WHERE name = ?')
    .get(nameOrUid.toUpperCase()) as unknown as KeyRow | undefined;
  if (byName) return byName;
  const byUid = d
    .prepare('SELECT * FROM keys WHERE uid = ? OR uid LIKE ?')
    .get(nameOrUid, `${nameOrUid}%`) as unknown as KeyRow | undefined;
  if (byUid) return byUid;
  logger.error(`key "${nameOrUid}" not found`);
  process.exitCode = 1;
  return undefined;
}

function loadBindings(keyUid: string): KeyBinding[] {
  const d = getDb();
  const rows = d
    .prepare('SELECT target_type, target_id FROM key_bindings WHERE key_uid = ?')
    .all(keyUid) as unknown as Array<{ target_type: 'channel' | 'bird'; target_id: string }>;
  return rows.map((r) => ({ targetType: r.target_type, targetId: r.target_id }));
}

function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf-8');
      stdin.on('data', (chunk) => {
        data += chunk;
      });
      stdin.on('end', () => resolve(data.trim()));
      return;
    }
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    let value = '';
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stderr.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(wasRaw ?? false);
        process.stderr.write('\n');
        process.exit(130);
      } else if (ch === '\u007F' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function initVaultKey(): void {
  const configPath = process.env['BROWSERBIRD_CONFIG']
    ? resolve(process.env['BROWSERBIRD_CONFIG'])
    : DEFAULT_CONFIG_PATH;
  const envPath = resolve(dirname(configPath), '.env');
  loadDotEnv(envPath);
  ensureVaultKey(envPath);
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

  openDatabase(resolveDbPathFromArgv(argv));
  initVaultKey();

  try {
    switch (subcommand) {
      case 'list': {
        const result = listKeys(1, 100);
        if (values.json) {
          console.log(JSON.stringify(result.items, null, 2));
          break;
        }
        console.log(`keys (${result.totalItems} total):`);
        if (result.items.length === 0) {
          console.log('\n  no keys stored');
          return;
        }
        console.log('');
        const rows = result.items.map((key) => {
          const bindings =
            key.bindings.map((b) => `${b.targetType}:${b.targetId}`).join(', ') || '-';
          return [key.name, key.hint, key.description ?? '-', bindings];
        });
        printTable(['name', 'value', 'description', 'bindings'], rows, [
          undefined,
          undefined,
          30,
          40,
        ]);
        break;
      }

      case 'add': {
        const name = positionals[0];
        if (!name) {
          logger.error(
            'usage: browserbird keys add <name> [--value <secret>] [--description <text>]',
          );
          process.exitCode = 1;
          return;
        }
        const validated = validateKeyName(name);
        if ('error' in validated) {
          logger.error(validated.error);
          process.exitCode = 1;
          return;
        }
        let secret = values.value as string | undefined;
        if (!secret) {
          secret = await promptSecret(`value for ${name.toUpperCase()}: `);
          if (!secret) {
            logger.error('value cannot be empty');
            process.exitCode = 1;
            return;
          }
        }
        try {
          const key = createKey(
            validated.name,
            secret,
            (values.description as string | undefined)?.trim(),
          );
          logger.success(`key ${key.name} created`);
          process.stderr.write(
            c('dim', `  hint: run 'browserbird keys bind ${key.name} channel *' to bind it`) + '\n',
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('UNIQUE constraint')) {
            logger.error(`a key named "${name.toUpperCase()}" already exists`);
          } else {
            logger.error(msg);
          }
          process.exitCode = 1;
        }
        break;
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
        const key = resolveKey(nameOrUid);
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
        const updated = updateKey(key.uid, fields);
        if (updated) {
          logger.success(`key ${key.name} updated`);
        } else {
          logger.error(`key ${key.name} not found`);
          process.exitCode = 1;
        }
        break;
      }

      case 'remove': {
        const nameOrUid = positionals[0];
        if (!nameOrUid) {
          logger.error('usage: browserbird keys remove <name>');
          process.exitCode = 1;
          return;
        }
        const key = resolveKey(nameOrUid);
        if (!key) return;
        if (deleteKey(key.uid)) {
          logger.success(`key ${key.name} removed`);
        } else {
          logger.error(`key ${key.name} not found`);
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
        const key = resolveKey(nameOrUid);
        if (!key) return;
        const existing = loadBindings(key.uid);
        if (existing.some((b) => b.targetType === targetType && b.targetId === targetId)) {
          logger.warn(`key ${key.name} is already bound to ${targetType} ${targetId}`);
          return;
        }
        replaceBindings(key.uid, [...existing, { targetType, targetId }]);
        logger.success(`key ${key.name} bound to ${targetType} ${targetId}`);
        break;
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
        const key = resolveKey(nameOrUid);
        if (!key) return;
        const existing = loadBindings(key.uid);
        const filtered = existing.filter(
          (b) => !(b.targetType === targetType && b.targetId === targetId),
        );
        if (filtered.length === existing.length) {
          logger.warn(`key ${key.name} is not bound to ${targetType} ${targetId}`);
          return;
        }
        replaceBindings(key.uid, filtered);
        logger.success(`key ${key.name} unbound from ${targetType} ${targetId}`);
        break;
      }

      default:
        unknownSubcommand(subcommand, 'keys', ['list', 'add', 'edit', 'remove', 'bind', 'unbind']);
    }
  } finally {
    closeDatabase();
  }
}

/** @fileoverview Spawn a CLI provider as a subprocess. */

import { spawn, type ChildProcess } from 'node:child_process';
import type { ProviderName, ProviderModule, SpawnOptions } from './types.ts';
import type { StreamEvent } from './stream.ts';
import { splitLines } from './stream.ts';
import { logger } from '../core/logger.ts';
import { claude } from './claude.ts';
import { opencode } from './opencode.ts';

const PROVIDERS: Record<ProviderName, ProviderModule> = {
  claude,
  opencode,
};

/** Env vars that prevent nested Claude Code sessions. */
const STRIPPED_ENV_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null && !STRIPPED_ENV_VARS.includes(key)) {
      env[key] = value;
    }
  }
  return env;
}

interface SpawnResult {
  events: AsyncIterable<StreamEvent>;
  kill: () => void;
}

/**
 * Spawns a provider CLI with streaming output.
 * Returns an async iterable of parsed stream events and a kill handle.
 */
export function spawnProvider(
  provider: ProviderName,
  options: SpawnOptions,
  signal: AbortSignal,
): SpawnResult {
  const mod = PROVIDERS[provider];
  const cmd = mod.buildCommand(options);
  const timeoutMs = options.agent.processTimeoutMs ?? 300_000;

  logger.debug(`spawning: ${cmd.binary} ${cmd.args.join(' ')} (timeout: ${timeoutMs}ms)`);

  const baseEnv = cleanEnv();
  if (cmd.env) {
    for (const [k, v] of Object.entries(cmd.env)) {
      if (v === '') delete baseEnv[k];
      else baseEnv[k] = v;
    }
  }
  const proc = spawn(cmd.binary, cmd.args, {
    cwd: cmd.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: baseEnv,
  });

  let stderrBuf = '';
  proc.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8');
  });

  const timeout = setTimeout(() => {
    logger.warn(`${cmd.binary} timed out after ${timeoutMs}ms, killing`);
    proc.kill('SIGTERM');
  }, timeoutMs);

  const onAbort = () => proc.kill('SIGTERM');
  signal.addEventListener('abort', onAbort, { once: true });

  async function* iterate(): AsyncIterable<StreamEvent> {
    let buffer = '';

    try {
      yield* parseStdout(proc, mod, buffer, (b) => {
        buffer = b;
      });

      if (buffer.trim()) {
        yield* mod.parseStreamLine(buffer);
      }
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (stderrBuf.trim()) {
        logger.debug(`${cmd.binary} stderr: ${stderrBuf.trim()}`);
      }
    }
  }

  return {
    events: iterate(),
    kill: () => proc.kill('SIGTERM'),
  };
}

async function* parseStdout(
  proc: ChildProcess,
  mod: ProviderModule,
  buffer: string,
  setBuffer: (b: string) => void,
): AsyncIterable<StreamEvent> {
  const pending: Buffer[] = [];
  let done = false;
  let error: string | null = null;
  let resolve: (() => void) | null = null;

  proc.stdout!.on('data', (chunk: Buffer) => {
    pending.push(chunk);
    resolve?.();
  });

  proc.on('error', (err: Error) => {
    error = err.message;
    done = true;
    resolve?.();
  });

  proc.on('close', () => {
    done = true;
    resolve?.();
  });

  while (true) {
    while (pending.length === 0 && !done) {
      await new Promise<void>((r) => {
        resolve = r;
      });
    }

    if (pending.length === 0 && done) break;

    while (pending.length > 0) {
      const data = pending.shift()!.toString('utf-8');
      logger.debug(`stdout chunk (${data.length} chars)`);
      const [lines, remaining] = splitLines(buffer, data);
      buffer = remaining;
      setBuffer(buffer);

      for (const line of lines) {
        yield* mod.parseStreamLine(line);
      }
    }
  }

  if (error) {
    yield { type: 'error', error };
  }
}

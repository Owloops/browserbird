/** @fileoverview Spawn the Claude CLI as a subprocess with streaming output. */

import { spawn, type ChildProcess } from 'node:child_process';
import type { SpawnOptions } from './claude.ts';
import { buildCommand, parseStreamLine } from './claude.ts';
import type { StreamEvent } from './stream.ts';
import { splitLines } from './stream.ts';
import { logger } from '../core/logger.ts';

export type { SpawnOptions } from './claude.ts';

const SIGKILL_GRACE_MS = 10_000;

/** Sends SIGTERM, then SIGKILL after a grace period if the process is still alive. */
function gracefulKill(proc: ChildProcess): void {
  if (!proc.pid || proc.killed) return;
  proc.kill('SIGTERM');
  const escalation = setTimeout(() => {
    if (!proc.killed) {
      logger.warn(`process ${proc.pid} did not exit after SIGTERM, sending SIGKILL`);
      proc.kill('SIGKILL');
    }
  }, SIGKILL_GRACE_MS);
  escalation.unref();
  proc.on('exit', () => clearTimeout(escalation));
}

/** Env vars that prevent nested Claude Code sessions. */
const STRIPPED_ENV_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];

/** Strips env vars whose names suggest they hold credentials. */
const SENSITIVE_NAME_RE = /KEY|SECRET|TOKEN|PASSWORD/i;

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) continue;
    if (STRIPPED_ENV_VARS.includes(key)) continue;
    if (SENSITIVE_NAME_RE.test(key)) continue;
    env[key] = value;
  }
  return env;
}

interface SpawnResult {
  events: AsyncIterable<StreamEvent>;
  kill: () => void;
}

/**
 * Spawns the Claude CLI with streaming output.
 * Returns an async iterable of parsed stream events and a kill handle.
 */
export function spawnProvider(options: SpawnOptions, signal: AbortSignal): SpawnResult {
  const cmd = buildCommand(options);
  const timeoutMs = options.agent.processTimeoutMs ?? options.globalTimeoutMs ?? 300_000;

  logger.debug(`spawning: ${cmd.binary} ${cmd.args.join(' ')} (timeout: ${timeoutMs}ms)`);

  const baseEnv = cleanEnv();
  if (cmd.env) {
    for (const [k, v] of Object.entries(cmd.env)) {
      if (v === '') delete baseEnv[k];
      else baseEnv[k] = v;
    }
  }
  if (options.extraEnv) {
    for (const [k, v] of Object.entries(options.extraEnv)) {
      baseEnv[k] = v;
    }
  }
  const proc = spawn(cmd.binary, cmd.args, {
    cwd: cmd.cwd ?? process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: baseEnv,
  });

  proc.stdin!.on('error', (err: Error & { code?: string }) => {
    if (err.code !== 'EPIPE') {
      logger.warn(`${cmd.binary} stdin error: ${err.message}`);
    }
  });
  proc.stdin!.end(options.message, 'utf-8');

  let stderrBuf = '';
  proc.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString('utf-8');
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    logger.warn(`${cmd.binary} timed out after ${timeoutMs}ms, killing`);
    gracefulKill(proc);
  }, timeoutMs);

  const onAbort = () => gracefulKill(proc);
  signal.addEventListener('abort', onAbort, { once: true });

  async function* iterate(): AsyncIterable<StreamEvent> {
    let buffer = '';

    try {
      yield* parseStdout(proc, buffer, (b) => {
        buffer = b;
      });

      if (buffer.trim()) {
        yield* parseStreamLine(buffer);
      }
      if (timedOut) {
        yield { type: 'timeout' as const, timeoutMs };
      }
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (stderrBuf.trim()) {
        logger.warn(`${cmd.binary} stderr: ${stderrBuf.trim()}`);
      }
    }
  }

  return {
    events: iterate(),
    kill: () => gracefulKill(proc),
  };
}

async function* parseStdout(
  proc: ChildProcess,
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
        yield* parseStreamLine(line);
      }
    }
  }

  if (error) {
    yield { type: 'error', error };
  }
}

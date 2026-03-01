/**
 * @fileoverview Structured logger. Respects NO_COLOR.
 *
 * Stream routing by mode:
 *   - CLI mode (default): all logs to stderr, keeping stdout clean for data output.
 *   - Daemon mode: errors/warnings to stderr, everything else to stdout.
 *     Cloud platforms (Railway, Fly, etc.) treat stderr lines as errors, so this
 *     prevents info lines from showing up red.
 *
 * Call `logger.setMode('daemon')` once at startup to switch.
 */

import { styleText } from 'node:util';

function shouldUseColor(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (process.env['TERM'] === 'dumb') return false;
  if (process.argv.includes('--no-color')) return false;
  return process.stdout.isTTY === true || process.stderr.isTTY === true;
}

const useColor = shouldUseColor();

function style(format: string | string[], text: string): string {
  if (!useColor) return text;
  return styleText(format as Parameters<typeof styleText>[0], text);
}

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
} as const;

type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];

let currentLevel: LogLevel = LOG_LEVELS.INFO;
let daemonMode = false;

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function out(prefix: string, message: string): void {
  const stream = daemonMode ? process.stdout : process.stderr;
  stream.write(`${style('dim', timestamp())} ${prefix} ${message}\n`);
}

function err(prefix: string, message: string): void {
  process.stderr.write(`${style('dim', timestamp())} ${prefix} ${message}\n`);
}

export const logger = {
  error(message: string): void {
    if (currentLevel >= LOG_LEVELS.ERROR) {
      err(style('red', '[error]'), message);
    }
  },

  warn(message: string): void {
    if (currentLevel >= LOG_LEVELS.WARN) {
      err(style('yellow', '[warn]'), message);
    }
  },

  info(message: string): void {
    if (currentLevel >= LOG_LEVELS.INFO) {
      out(style('blue', '[info]'), message);
    }
  },

  debug(message: string): void {
    if (currentLevel >= LOG_LEVELS.DEBUG) {
      out(style('dim', '[debug]'), message);
    }
  },

  success(message: string): void {
    if (currentLevel >= LOG_LEVELS.INFO) {
      out(style('green', '[ok]'), message);
    }
  },

  setLevel(level: 'error' | 'warn' | 'info' | 'debug'): void {
    const map: Record<string, LogLevel> = {
      error: LOG_LEVELS.ERROR,
      warn: LOG_LEVELS.WARN,
      info: LOG_LEVELS.INFO,
      debug: LOG_LEVELS.DEBUG,
    };
    currentLevel = map[level] ?? LOG_LEVELS.INFO;
  },

  setMode(mode: 'cli' | 'daemon'): void {
    daemonMode = mode === 'daemon';
  },
};

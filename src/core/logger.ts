/** @fileoverview Structured logger. Writes to stderr, respects NO_COLOR. */

import { styleText } from 'node:util';

function shouldUseColor(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (process.env['TERM'] === 'dumb') return false;
  if (process.argv.includes('--no-color')) return false;
  return process.stderr.isTTY === true;
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

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function write(prefix: string, message: string): void {
  process.stderr.write(`${style('dim', timestamp())} ${prefix} ${message}\n`);
}

export const logger = {
  error(message: string): void {
    if (currentLevel >= LOG_LEVELS.ERROR) {
      write(style('red', '[error]'), message);
    }
  },

  warn(message: string): void {
    if (currentLevel >= LOG_LEVELS.WARN) {
      write(style('yellow', '[warn]'), message);
    }
  },

  info(message: string): void {
    if (currentLevel >= LOG_LEVELS.INFO) {
      write(style('blue', '[info]'), message);
    }
  },

  debug(message: string): void {
    if (currentLevel >= LOG_LEVELS.DEBUG) {
      write(style('dim', '[debug]'), message);
    }
  },

  success(message: string): void {
    if (currentLevel >= LOG_LEVELS.INFO) {
      write(style('green', '[ok]'), message);
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
};

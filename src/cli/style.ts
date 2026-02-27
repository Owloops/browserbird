/** @fileoverview CLI color utilities. Safe palette per terminal theme compatibility. */

import { styleText } from 'node:util';

function shouldUseColor(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (process.env['TERM'] === 'dumb') return false;
  if (process.argv.includes('--no-color')) return false;
  return process.stdout.isTTY === true;
}

const useColor = shouldUseColor();

type Format = Parameters<typeof styleText>[0];

export function c(format: Format, text: string): string {
  if (!useColor) return text;
  return styleText(format, text);
}

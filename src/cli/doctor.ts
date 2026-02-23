/** @fileoverview Doctor command — checks system dependencies. */

import { execFileSync } from 'node:child_process';
import { logger } from '../core/logger.ts';

export const DOCTOR_HELP = `
usage: browserbird doctor

check system dependencies (claude cli, node.js).
`.trim();

export interface DoctorResult {
  claude: { available: boolean; version: string | null };
  node: string;
}

export function checkDoctor(): DoctorResult {
  try {
    const output = execFileSync('claude', ['--version'], {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const version = output.trim().split('\n')[0] ?? null;
    return { claude: { available: true, version }, node: process.version };
  } catch {
    return { claude: { available: false, version: null }, node: process.version };
  }
}

export function handleDoctor(): void {
  const result = checkDoctor();
  console.log('doctor');
  console.log('------');
  if (result.claude.available) {
    logger.success(`claude cli: ${result.claude.version}`);
  } else {
    logger.error('claude cli: not found');
    process.stderr.write('  install: npm install -g @anthropic-ai/claude-code\n');
  }
  logger.success(`node.js: ${result.node}`);
}

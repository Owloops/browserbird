/** @fileoverview Doctor command: checks system dependencies. */

import { execFileSync } from 'node:child_process';
import { logger } from '../core/logger.ts';
import { c } from './style.ts';

export const DOCTOR_HELP = `
${c('cyan', 'usage:')} browserbird doctor

check system dependencies (agent cli, node.js).
`.trim();

interface CliStatus {
  available: boolean;
  version: string | null;
}

export interface DoctorResult {
  claude: CliStatus;
  node: string;
}

function checkCli(binary: string, versionArgs: string[]): CliStatus {
  try {
    const output = execFileSync(binary, versionArgs, {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const version = (output.trim().split('\n')[0] ?? '').replace(/\s*\(.*\)$/, '') || null;
    return { available: true, version };
  } catch {
    return { available: false, version: null };
  }
}

export function checkDoctor(): DoctorResult {
  return {
    claude: checkCli('claude', ['--version']),
    node: process.version,
  };
}

export function handleDoctor(): void {
  const result = checkDoctor();
  console.log(c('cyan', 'doctor'));
  console.log(c('dim', '------'));
  if (result.claude.available) {
    logger.success(`claude cli: ${result.claude.version}`);
  } else {
    logger.error('claude cli: not found');
    process.stderr.write('  install: npm install -g @anthropic-ai/claude-code\n');
  }
  logger.success(`node.js: ${result.node}`);
}

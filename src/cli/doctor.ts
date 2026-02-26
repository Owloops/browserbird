/** @fileoverview Doctor command — checks system dependencies. */

import { execFileSync } from 'node:child_process';
import { logger } from '../core/logger.ts';

export const DOCTOR_HELP = `
usage: browserbird doctor

check system dependencies (agent clis, node.js).
`.trim();

interface CliStatus {
  available: boolean;
  version: string | null;
}

export interface DoctorResult {
  claude: CliStatus;
  opencode: CliStatus;
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
    opencode: checkCli('opencode', ['--version']),
    node: process.version,
  };
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
  if (result.opencode.available) {
    logger.success(`opencode cli: ${result.opencode.version}`);
  } else {
    logger.warn('opencode cli: not found (optional)');
    process.stderr.write('  install: npm install -g opencode\n');
  }
  logger.success(`node.js: ${result.node}`);
}

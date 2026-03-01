/** @fileoverview ASCII banner displayed on daemon startup and in help text. */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const buildInfo: string[] = [];
if (process.env.GITHUB_SHA) {
  buildInfo.push(`commit: ${process.env.GITHUB_SHA.substring(0, 7)}`);
}
if (process.env.BUILD_DATE) {
  buildInfo.push(`built: ${process.env.BUILD_DATE}`);
}
const buildString = buildInfo.length > 0 ? ` (${buildInfo.join(', ')})` : '';

export const VERSION = `browserbird ${pkg.version}${buildString}`;

const BIRD = ['   .__.', '   ( ^>', '   / )\\', '  <_/_/', '   " "'].join('\n');

export const BANNER = BIRD;

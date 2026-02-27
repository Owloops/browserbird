/** @fileoverview ASCII banner displayed on daemon startup and in help text. */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const VERSION: string = (require('../../package.json') as { version: string }).version;

const BIRD = ['   .__.', '   ( ^>', '   / )\\', '  <_/_/', '   " "'].join('\n');

export const BANNER = BIRD;

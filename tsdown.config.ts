import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  clean: true,
  nodeProtocol: true,
  deps: {
    skipNodeModulesBundle: true,
  },
  env: {
    GITHUB_SHA: process.env.GITHUB_SHA || '',
    BUILD_DATE: process.env.BUILD_DATE || '',
  },
});

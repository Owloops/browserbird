/** @fileoverview Settings command: display full configuration. */

import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';

export const SETTINGS_HELP = `
usage: browserbird settings [options]

view full configuration.

options:

  --config <path>  config file path
  -h, --help       show this help
`.trim();

export function handleSettings(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { config: { type: 'string' } },
    allowPositionals: false,
    strict: false,
  });
  printSettingsAll(values.config as string | undefined);
}

function printSettingsAll(configPath?: string): void {
  const config = loadConfig(configPath);

  console.log('settings');
  console.log('--------');
  console.log(`\ntimezone: ${config.timezone}`);

  console.log('\nagents:');
  for (const a of config.agents) {
    console.log(`  ${a.id} (${a.name})`);
    console.log(`    provider:  ${a.provider}`);
    console.log(`    model:     ${a.model}`);
    console.log(`    max turns: ${a.maxTurns}`);
    console.log(`    channels:  ${a.channels.join(', ') || '*'}`);
  }

  console.log('\nsessions:');
  console.log(`  max concurrent:  ${config.sessions.maxConcurrent}`);
  console.log(`  ttl:             ${config.sessions.ttlHours}h`);
  console.log(`  timeout:         ${config.sessions.processTimeoutMs / 1000}s`);

  console.log('\nslack:');
  console.log(`  require mention: ${config.slack.requireMention ? 'yes' : 'no'}`);
  console.log(`  debounce:        ${config.slack.coalesce.debounceMs}ms`);
  console.log(`  bypass dms:      ${config.slack.coalesce.bypassDms ? 'yes' : 'no'}`);
  console.log(`  channels:        ${config.slack.channels.join(', ') || '(all)'}`);
  console.log(
    `  quiet hours:     ${config.slack.quietHours.enabled ? `${config.slack.quietHours.start}-${config.slack.quietHours.end} (${config.slack.quietHours.timezone})` : 'disabled'}`,
  );

  console.log('\nbirds:');
  console.log(`  max attempts: ${config.birds.maxAttempts}`);

  console.log('\nbrowser:');
  console.log(`  enabled:    ${config.browser.enabled ? 'yes' : 'no'}`);
  if (config.browser.enabled) {
    console.log(`  mode:       ${process.env['BROWSER_MODE'] ?? 'persistent'}`);
    console.log(`  vnc port:   ${config.browser.vncPort}`);
    console.log(`  novnc port: ${config.browser.novncPort}`);
  }

  console.log('\ndatabase:');
  console.log(`  retention: ${config.database.retentionDays}d`);

  console.log('\nweb:');
  console.log(`  port: ${config.web.port}`);
}

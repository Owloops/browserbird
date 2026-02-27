/** @fileoverview Config command: display merged configuration. */

import { parseArgs } from 'node:util';
import { loadRawConfig } from '../config.ts';
import type { Config } from '../core/types.ts';
import { c } from './style.ts';

export const CONFIG_HELP = `
${c('cyan', 'usage:')} browserbird config [options]

view full configuration (defaults merged with browserbird.json).

${c('dim', 'options:')}

  ${c('yellow', '--config')} <path>  config file path
  ${c('yellow', '-h, --help')}       show this help
`.trim();

export function handleConfig(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: { config: { type: 'string' } },
    allowPositionals: false,
    strict: false,
  });
  printConfig(values.config as string | undefined);
}

function printConfig(configPath?: string): void {
  const config = loadRawConfig(configPath) as unknown as Config;

  console.log(c('cyan', 'config'));
  console.log(c('dim', '------'));
  console.log(`\n${c('dim', 'timezone:')} ${config.timezone}`);

  console.log(`\n${c('cyan', 'agents:')}`);
  for (const a of config.agents) {
    console.log(`  ${c('cyan', a.id)} (${a.name})`);
    console.log(`    ${c('dim', 'provider:')}  ${a.provider}`);
    console.log(`    ${c('dim', 'model:')}     ${a.model}`);
    console.log(`    ${c('dim', 'max turns:')} ${a.maxTurns}`);
    console.log(`    ${c('dim', 'channels:')}  ${a.channels.join(', ') || '*'}`);
  }

  console.log(`\n${c('cyan', 'sessions:')}`);
  console.log(`  ${c('dim', 'max concurrent:')}  ${config.sessions.maxConcurrent}`);
  console.log(`  ${c('dim', 'ttl:')}             ${config.sessions.ttlHours}h`);
  console.log(`  ${c('dim', 'timeout:')}         ${config.sessions.processTimeoutMs / 1000}s`);

  console.log(`\n${c('cyan', 'slack:')}`);
  console.log(`  ${c('dim', 'require mention:')} ${config.slack.requireMention ? 'yes' : 'no'}`);
  console.log(`  ${c('dim', 'debounce:')}        ${config.slack.coalesce.debounceMs}ms`);
  console.log(
    `  ${c('dim', 'bypass dms:')}      ${config.slack.coalesce.bypassDms ? 'yes' : 'no'}`,
  );
  console.log(`  ${c('dim', 'channels:')}        ${config.slack.channels.join(', ') || '(all)'}`);
  console.log(
    `  ${c('dim', 'quiet hours:')}     ${config.slack.quietHours.enabled ? `${config.slack.quietHours.start}-${config.slack.quietHours.end} (${config.slack.quietHours.timezone})` : 'disabled'}`,
  );

  console.log(`\n${c('cyan', 'birds:')}`);
  console.log(`  ${c('dim', 'max attempts:')} ${config.birds.maxAttempts}`);

  console.log(`\n${c('cyan', 'browser:')}`);
  console.log(`  ${c('dim', 'enabled:')}    ${config.browser.enabled ? 'yes' : 'no'}`);
  if (config.browser.enabled) {
    console.log(`  ${c('dim', 'mode:')}       ${process.env['BROWSER_MODE'] ?? 'persistent'}`);
    console.log(`  ${c('dim', 'vnc port:')}   ${config.browser.vncPort}`);
    console.log(`  ${c('dim', 'novnc port:')} ${config.browser.novncPort}`);
  }

  console.log(`\n${c('cyan', 'database:')}`);
  console.log(`  ${c('dim', 'retention:')} ${config.database.retentionDays}d`);

  console.log(`\n${c('cyan', 'web:')}`);
  console.log(`  ${c('dim', 'port:')} ${config.web.port}`);
}

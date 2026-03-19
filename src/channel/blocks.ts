/** @fileoverview Slack Block Kit builder functions for rich message formatting. */

import type { StreamEventCompletion } from '../provider/stream.ts';
import { formatDuration } from '../core/utils.ts';
import { shortUid } from '../core/uid.ts';

/**
 * Slack Block Kit block types used throughout the channel layer.
 * Intentionally minimal, only the shapes we actually construct.
 */

interface PlainText {
  type: 'plain_text';
  text: string;
  emoji?: boolean;
}

interface MrkdwnText {
  type: 'mrkdwn';
  text: string;
}

type TextObject = PlainText | MrkdwnText;

interface HeaderBlock {
  type: 'header';
  text: PlainText;
}

interface SectionBlock {
  type: 'section';
  text?: MrkdwnText;
  fields?: MrkdwnText[];
  accessory?: OverflowElement | ButtonElement;
}

interface DividerBlock {
  type: 'divider';
}

interface ContextBlock {
  type: 'context';
  elements: TextObject[];
}

interface FeedbackButtonObject {
  text: PlainText;
  value: string;
}

interface FeedbackButtonsElement {
  type: 'feedback_buttons';
  action_id: string;
  positive_button: FeedbackButtonObject;
  negative_button: FeedbackButtonObject;
}

interface ContextActionsBlock {
  type: 'context_actions';
  elements: FeedbackButtonsElement[];
}

interface ActionsBlock {
  type: 'actions';
  block_id?: string;
  elements: ActionElement[];
}

interface InputBlock {
  type: 'input';
  block_id: string;
  label: PlainText;
  element: InputElement;
  optional?: boolean;
}

interface ButtonElement {
  type: 'button';
  text: PlainText;
  action_id: string;
  value?: string;
  url?: string;
  style?: 'primary' | 'danger';
}

interface OverflowElement {
  type: 'overflow';
  action_id: string;
  options: OverflowOption[];
}

interface OverflowOption {
  text: PlainText;
  value: string;
}

interface PlainTextInputElement {
  type: 'plain_text_input';
  action_id: string;
  placeholder?: PlainText;
  multiline?: boolean;
  initial_value?: string;
}

interface StaticSelectElement {
  type: 'static_select';
  action_id: string;
  placeholder?: PlainText;
  options: SelectOption[];
  initial_option?: SelectOption;
}

interface ConversationsSelectElement {
  type: 'conversations_select';
  action_id: string;
  default_to_current_conversation?: boolean;
}

interface RadioButtonsElement {
  type: 'radio_buttons';
  action_id: string;
  options: SelectOption[];
  initial_option?: SelectOption;
}

interface SelectOption {
  text: PlainText;
  value: string;
}

type ActionElement = ButtonElement | OverflowElement | StaticSelectElement;
type InputElement =
  | PlainTextInputElement
  | StaticSelectElement
  | ConversationsSelectElement
  | RadioButtonsElement;

export type Block =
  | HeaderBlock
  | SectionBlock
  | DividerBlock
  | ContextBlock
  | ContextActionsBlock
  | ActionsBlock
  | InputBlock;

export interface ModalView {
  type: 'modal';
  callback_id: string;
  title: PlainText;
  submit?: PlainText;
  close?: PlainText;
  private_metadata?: string;
  blocks: Block[];
}

export interface HomeView {
  type: 'home';
  blocks: Block[];
}

function plain(text: string): PlainText {
  return { type: 'plain_text', text, emoji: true };
}

function mrkdwn(text: string): MrkdwnText {
  return { type: 'mrkdwn', text };
}

function header(text: string): HeaderBlock {
  return { type: 'header', text: plain(text) };
}

function section(text: string): SectionBlock {
  return { type: 'section', text: mrkdwn(text) };
}

function fields(...pairs: [string, string][]): SectionBlock {
  return {
    type: 'section',
    fields: pairs.map(([label, value]) => mrkdwn(`*${label}:*\n${value}`)),
  };
}

function divider(): DividerBlock {
  return { type: 'divider' };
}

function context(text: string): ContextBlock {
  return { type: 'context', elements: [mrkdwn(text)] };
}

function feedbackButtons(): ContextActionsBlock {
  return {
    type: 'context_actions',
    elements: [
      {
        type: 'feedback_buttons',
        action_id: 'response_feedback',
        positive_button: { text: plain('Good'), value: 'good' },
        negative_button: { text: plain('Bad'), value: 'bad' },
      },
    ],
  };
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const SUBTYPE_LABELS: Record<string, string> = {
  error_max_turns: 'Warning: Hit turn limit',
  error_max_budget_usd: 'Warning: Hit budget limit',
  error_during_execution: 'Error during execution',
  error_max_structured_output_retries: 'Structured output failed',
};

/**
 * Builds a context footer appended to the streaming message on completion.
 * Uses only non-section blocks (divider + context) so Slack renders the
 * response text from the top-level `text` field, avoiding the 3000-char
 * section limit for long agent responses.
 */
export function completionFooterBlocks(
  completion: StreamEventCompletion,
  hasError: boolean,
  birdName?: string,
  userId?: string,
): Block[] {
  const parts: string[] = [];

  const subtypeLabel = SUBTYPE_LABELS[completion.subtype];
  if (subtypeLabel) parts.push(subtypeLabel);
  if (hasError) parts.push('Error');

  if (userId) parts.push(`Requested by <@${userId}>`);
  parts.push(formatDuration(completion.durationMs));
  parts.push(`${completion.numTurns} turn${completion.numTurns === 1 ? '' : 's'}`);
  if (birdName) parts.push(birdName);

  return [
    divider(),
    feedbackButtons(),
    context(parts.join('  |  ')),
    context('BrowserBird can hallucinate and may be inaccurate.'),
  ];
}

/**
 * Standalone completion card for cron/bird results posted to a channel
 * (not in a streaming thread; these need full context).
 */
export function sessionCompleteBlocks(
  completion: StreamEventCompletion,
  summary: string | undefined,
  birdName?: string,
  userId?: string,
): Block[] {
  const subtypeLabel = SUBTYPE_LABELS[completion.subtype];
  const statusText = subtypeLabel ?? 'Success';
  const headerText = completion.subtype === 'success' ? 'Session Complete' : 'Session Ended';

  const blocks: Block[] = [
    header(headerText),
    fields(
      ['Status', statusText],
      ['Duration', formatDuration(completion.durationMs)],
      ['Turns', String(completion.numTurns)],
    ),
  ];

  if (summary) {
    const trimmed = summary.length > 2800 ? summary.slice(0, 2800) + '...' : summary;
    blocks.push(section(`*Summary:*\n${trimmed}`));
  }

  const contextParts: string[] = [];
  if (birdName) contextParts.push(`Bird: *${birdName}*`);
  if (userId) contextParts.push(`Triggered by <@${userId}>`);
  contextParts.push(
    `${completion.tokensIn.toLocaleString()} in / ${completion.tokensOut.toLocaleString()} out tokens`,
  );
  blocks.push(context(contextParts.join(' | ')));

  return blocks;
}

export function sessionErrorBlocks(
  errorMessage: string,
  opts?: {
    sessionUid?: string;
    birdName?: string;
    durationMs?: number;
  },
): Block[] {
  const blocks: Block[] = [header('Session Failed')];

  const sectionBlock: SectionBlock = {
    type: 'section',
    text: mrkdwn(`*Error: ${truncate(errorMessage, 200)}*`),
  };

  if (opts?.sessionUid) {
    sectionBlock.accessory = {
      type: 'overflow',
      action_id: 'session_error_overflow',
      options: [
        { text: plain('Retry'), value: `retry:${opts.sessionUid}` },
        { text: plain('View Logs'), value: `logs:${opts.sessionUid}` },
      ],
    };
  }

  blocks.push(sectionBlock);

  const fieldPairs: [string, string][] = [];
  if (opts?.birdName) fieldPairs.push(['Bird', opts.birdName]);
  if (opts?.durationMs) fieldPairs.push(['Duration', formatDuration(opts.durationMs)]);
  if (fieldPairs.length > 0) blocks.push(fields(...fieldPairs));

  return blocks;
}

export function sessionTimeoutBlocks(timeoutMs: number, opts?: { sessionUid?: string }): Block[] {
  const minutes = Math.round(timeoutMs / 60_000);
  const blocks: Block[] = [
    header('Session Timed Out'),
    section(
      `The session was stopped after *${minutes} minute${minutes === 1 ? '' : 's'}* (the configured limit).\n\nReply to continue in a new session, or increase \`sessions.processTimeoutMs\` in your config to allow longer runs.`,
    ),
  ];

  if (opts?.sessionUid) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: plain('Retry'),
          action_id: 'session_retry',
          value: `retry:${opts.sessionUid}`,
        },
      ],
    });
  }

  return blocks;
}

export function busyBlocks(activeCount: number, maxConcurrent: number): Block[] {
  return [
    section('*Too many active sessions*'),
    context(`${activeCount}/${maxConcurrent} slots in use. Try again shortly.`),
  ];
}

export function noAgentBlocks(channelId: string): Block[] {
  return [section('*No agent configured for this channel*'), context(`Channel: \`${channelId}\``)];
}

export function birdCreateModal(defaults?: {
  name?: string;
  schedule?: string;
  prompt?: string;
}): ModalView {
  const scheduleOptions: SelectOption[] = [
    { text: plain('Every hour'), value: '0 * * * *' },
    { text: plain('Every 6 hours'), value: '0 */6 * * *' },
    { text: plain('Daily at midnight'), value: '0 0 * * *' },
    { text: plain('Weekly on Monday'), value: '0 0 * * 1' },
  ];

  const initialSchedule = defaults?.schedule
    ? scheduleOptions.find((o) => o.value === defaults.schedule)
    : undefined;

  return {
    type: 'modal',
    callback_id: 'bird_create',
    title: plain('Create Bird'),
    submit: plain('Create'),
    close: plain('Cancel'),
    blocks: [
      {
        type: 'input',
        block_id: 'bird_name',
        label: plain('Name'),
        element: {
          type: 'plain_text_input',
          action_id: 'name_input',
          placeholder: plain('e.g., lint-patrol'),
          ...(defaults?.name ? { initial_value: defaults.name } : {}),
        },
      },
      {
        type: 'input',
        block_id: 'bird_schedule',
        label: plain('Schedule'),
        element: {
          type: 'static_select',
          action_id: 'schedule_select',
          placeholder: plain('Choose a schedule'),
          options: scheduleOptions,
          ...(initialSchedule ? { initial_option: initialSchedule } : {}),
        },
      },
      {
        type: 'input',
        block_id: 'bird_prompt',
        label: plain('Prompt'),
        element: {
          type: 'plain_text_input',
          action_id: 'prompt_input',
          multiline: true,
          placeholder: plain('What should this bird do?'),
          ...(defaults?.prompt ? { initial_value: defaults.prompt } : {}),
        },
      },
      {
        type: 'input',
        block_id: 'bird_channel',
        label: plain('Report to Channel'),
        element: {
          type: 'conversations_select',
          action_id: 'channel_select',
          default_to_current_conversation: true,
        },
      },
      {
        type: 'input',
        block_id: 'bird_enabled',
        label: plain('Status'),
        element: {
          type: 'radio_buttons',
          action_id: 'enabled_radio',
          options: [
            { text: plain('Enabled'), value: 'enabled' },
            { text: plain('Disabled'), value: 'disabled' },
          ],
          initial_option: { text: plain('Enabled'), value: 'enabled' },
        },
      },
    ],
  };
}

export function birdListBlocks(
  birds: Array<{
    uid: string;
    name: string;
    schedule: string;
    enabled: boolean;
    lastStatus: string | null;
    agentId: string;
  }>,
): Block[] {
  if (birds.length === 0) {
    return [
      section('*No birds configured*'),
      context('Use `/bird create` to create your first bird.'),
    ];
  }

  const blocks: Block[] = [header('Active Birds')];

  for (const bird of birds) {
    const status = bird.enabled ? '[on]' : '[off]';
    const lastRun = bird.lastStatus ?? 'never';
    blocks.push(
      section(
        `${status} *${bird.name}*\n\`${bird.schedule}\` | Agent: \`${bird.agentId}\` | Last: ${lastRun}`,
      ),
    );
  }

  blocks.push(context(`${birds.length} bird${birds.length === 1 ? '' : 's'} total`));

  return blocks;
}

export function birdLogsBlocks(
  birdName: string,
  flights: Array<{
    uid: string;
    status: string;
    startedAt: string;
    durationMs?: number;
    error?: string;
  }>,
): Block[] {
  if (flights.length === 0) {
    return [
      section(`*${birdName}* - No flights yet`),
      context('Trigger with `/bird fly ${birdName}`'),
    ];
  }

  const blocks: Block[] = [header(`Flights: ${birdName}`)];

  const lines = flights.map((f) => {
    const icon = f.status === 'success' ? '[ok]' : f.status === 'running' ? '[...]' : '[err]';
    const duration = f.durationMs ? formatDuration(f.durationMs) : '-';
    const age = formatAge(f.startedAt);
    const detail = f.error ? truncate(f.error, 80) : duration;
    return `${icon}  ${shortUid(f.uid)} \`${detail}\` - ${age} ago`;
  });

  blocks.push(section(lines.join('\n')));
  blocks.push(context(`${flights.length} most recent flight${flights.length === 1 ? '' : 's'}`));

  return blocks;
}

function formatAge(isoDate: string): string {
  const normalized = isoDate.endsWith('Z') ? isoDate : isoDate + 'Z';
  const ms = Date.now() - new Date(normalized).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function birdFlyBlocks(birdName: string, userId: string): Block[] {
  return [section(`*${birdName}* is taking flight...`), context(`Triggered by <@${userId}>`)];
}

export function statusBlocks(opts: {
  slackConnected: boolean;
  activeCount: number;
  maxConcurrent: number;
  birdCount: number;
  uptime: string;
  runningBirds?: string[];
}): Block[] {
  const slackStatus = opts.slackConnected ? 'Connected' : 'Disconnected';

  const result: Block[] = [
    header('BrowserBird Status'),
    fields(
      ['Slack', slackStatus],
      ['Active Sessions', `${opts.activeCount}/${opts.maxConcurrent}`],
      ['Birds', String(opts.birdCount)],
      ['Uptime', opts.uptime],
    ),
  ];

  if (opts.runningBirds && opts.runningBirds.length > 0) {
    result.push(section(`*In flight:* ${opts.runningBirds.join(', ')}`));
  }

  return result;
}

export function homeTabView(opts: {
  agentName: string;
  description: string;
  birds: Array<{ name: string; schedule: string; enabled: boolean }>;
  activeSessions: number;
  maxConcurrent: number;
}): HomeView {
  const blocks: Block[] = [
    header(opts.agentName),
    section(opts.description),
    divider(),
    header('Scheduled Birds'),
  ];

  if (opts.birds.length === 0) {
    blocks.push(section('No birds configured. Use `/bird create` to get started.'));
  } else {
    const lines = opts.birds.map((b) => {
      const status = b.enabled ? 'on' : 'off';
      return `[${status}] *${b.name}* \`${b.schedule}\``;
    });
    blocks.push(section(lines.join('\n')));
  }

  blocks.push(
    divider(),
    header('Quick Commands'),
    section(
      [
        '`/bird list` -- show all birds',
        '`/bird create` -- create a new bird',
        '`/bird fly <name>` -- trigger a bird now',
        '`/bird status` -- check system status',
      ].join('\n'),
    ),
    divider(),
    context(`${opts.activeSessions}/${opts.maxConcurrent} active sessions`),
  );

  return { type: 'home' as const, blocks };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

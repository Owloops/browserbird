/** @fileoverview Shared utilities: formatting, time ranges, and CLI table output. */

const BIRD_NAME_MAX_LENGTH = 50;

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function deriveBirdName(prompt: string): string {
  return prompt.trim().slice(0, BIRD_NAME_MAX_LENGTH);
}

/**
 * Returns true if the current time in the given timezone falls within a HH:MM time range.
 * Handles wrap-around ranges (e.g. 22:00-06:00 spanning midnight).
 */
export function isWithinTimeRange(
  start: string,
  end: string,
  date: Date,
  timezone: string,
): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);

  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const nowMinutes = h * 60 + m;

  const startMinutes = parseHHMM(start);
  const endMinutes = parseHHMM(end);

  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function parseHHMM(s: string): number {
  const [hh, mm] = s.split(':');
  const h = Number(hh);
  const m = Number(mm ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLength(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

/** Print a formatted table with auto-calculated column widths to stdout. */
export function printTable(
  headers: string[],
  rows: string[][],
  maxWidths?: Array<number | undefined>,
): void {
  const widths = headers.map((h) => h.length);

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const cellLen = visibleLength(row[i] ?? '');
      const maxW = maxWidths?.[i];
      const capped = maxW != null ? Math.min(cellLen, maxW) : cellLen;
      widths[i] = Math.max(widths[i] ?? 0, capped);
    }
  }

  function pad(s: string, width: number, max?: number): string {
    const vis = visibleLength(s);
    const truncated = max != null && vis > max ? s.slice(0, max - 3) + '...' : s;
    const padLen = width - visibleLength(truncated);
    return padLen > 0 ? truncated + ' '.repeat(padLen) : truncated;
  }

  const indent = '  ';
  console.log(indent + headers.map((h, i) => pad(h, widths[i]!)).join('  '));
  console.log(indent + widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(
      indent + row.map((cell, i) => pad(cell ?? '', widths[i]!, maxWidths?.[i])).join('  '),
    );
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

export function unknownSubcommand(
  subcommand: string,
  command: string,
  validCommands?: string[],
): void {
  const label = command ? 'subcommand' : 'command';
  process.stderr.write(`error: unknown ${label}: ${subcommand}\n`);
  if (validCommands && validCommands.length > 0) {
    let bestMatch = '';
    let bestDist = Infinity;
    for (const cmd of validCommands) {
      const dist = levenshtein(subcommand, cmd);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = cmd;
      }
    }
    if (bestDist <= 2 && bestMatch) {
      process.stderr.write(`did you mean '${bestMatch}'?\n`);
    }
  }
  const helpCmd = command ? `browserbird ${command} --help` : 'browserbird --help';
  process.stderr.write(`run '${helpCmd}' for usage\n`);
  process.exitCode = 1;
}

/** @fileoverview Cron expression parser. Standard 5-field syntax + common macros. */

import { isWithinTimeRange } from '../core/utils.ts';

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

/**
 * Parses a single cron field (e.g. `"*"`, `"1,5,10"`, `"9-17"`, `"* /15"`).
 * Returns a Set of integer values that match.
 */
function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const stepParts = part.split('/');
    const range = stepParts[0]!;
    const step = stepParts[1] != null ? parseInt(stepParts[1], 10) : 1;

    let start: number;
    let end: number;

    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [lo, hi] = range.split('-');
      start = parseInt(lo!, 10);
      end = parseInt(hi!, 10);
    } else {
      start = parseInt(range, 10);
      end = start;
    }

    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  return values;
}

/** Parses a cron expression string into a CronSchedule. */
export function parseCron(expression: string): CronSchedule {
  const expanded = MACROS[expression.toLowerCase()] ?? expression;
  const fields = expanded.trim().split(/\s+/);

  if (fields.length !== 5) {
    throw new Error(`invalid cron expression: expected 5 fields, got ${fields.length}`);
  }

  return {
    minutes: parseField(fields[0]!, 0, 59),
    hours: parseField(fields[1]!, 0, 23),
    daysOfMonth: parseField(fields[2]!, 1, 31),
    months: parseField(fields[3]!, 1, 12),
    daysOfWeek: parseField(fields[4]!, 0, 6),
  };
}

/**
 * Returns true if the current time falls within the active hours window.
 * When both start and end are null, the bird is always active.
 * Hours are evaluated in the bird's configured timezone.
 */
export function isWithinActiveHours(
  start: string | null,
  end: string | null,
  date: Date,
  timezone?: string,
): boolean {
  if (start == null && end == null) return true;
  return isWithinTimeRange(start ?? '00:00', end ?? '24:00', date, timezone || 'UTC');
}

/**
 * Returns the next Date (after `after`) that matches the cron schedule,
 * or null if no match is found within the search window (default: 366 days).
 */
export function nextCronMatch(
  schedule: CronSchedule,
  after: Date,
  timezone?: string,
  maxMinutes = 527_040,
): Date | null {
  const candidate = new Date(after.getTime());
  candidate.setSeconds(0, 0);
  candidate.setTime(candidate.getTime() + 60_000);

  for (let i = 0; i < maxMinutes; i++) {
    if (matchesCron(schedule, candidate, timezone)) return candidate;
    candidate.setTime(candidate.getTime() + 60_000);
  }
  return null;
}

/** Returns true if the given Date matches the cron schedule in the specified timezone. */
export function matchesCron(schedule: CronSchedule, date: Date, timezone?: string): boolean {
  const tz = timezone || 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return (
    schedule.minutes.has(get('minute')) &&
    schedule.hours.has(get('hour')) &&
    schedule.daysOfMonth.has(get('day')) &&
    schedule.months.has(get('month')) &&
    schedule.daysOfWeek.has(weekdayMap[weekdayStr] ?? 0)
  );
}

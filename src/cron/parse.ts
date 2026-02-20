/** @fileoverview Cron expression parser. Standard 5-field syntax + common macros. */

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

/** Returns true if the given Date matches the cron schedule. */
export function matchesCron(schedule: CronSchedule, date: Date): boolean {
  return (
    schedule.minutes.has(date.getMinutes()) &&
    schedule.hours.has(date.getHours()) &&
    schedule.daysOfMonth.has(date.getDate()) &&
    schedule.months.has(date.getMonth() + 1) &&
    schedule.daysOfWeek.has(date.getDay())
  );
}

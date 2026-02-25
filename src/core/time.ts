/** @fileoverview Time-range utility for quiet hours and active hours checks. */

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

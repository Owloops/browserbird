/** @fileoverview In-memory error rate counters using sliding 60-minute buckets. */

export type ErrorSource = 'spawn' | 'handler' | 'slack' | 'cron';

interface MinuteBucket {
  minute: number;
  counts: Record<ErrorSource, number>;
}

const BUCKET_COUNT = 60;

const buckets: MinuteBucket[] = Array.from({ length: BUCKET_COUNT }, () => ({
  minute: -1,
  counts: { spawn: 0, handler: 0, slack: 0, cron: 0 },
}));

function currentMinute(): number {
  return Math.floor(Date.now() / 60_000);
}

function getBucket(minute: number): MinuteBucket {
  const slot = minute % BUCKET_COUNT;
  const bucket = buckets[slot]!;
  if (bucket.minute !== minute) {
    bucket.minute = minute;
    bucket.counts = { spawn: 0, handler: 0, slack: 0, cron: 0 };
  }
  return bucket;
}

export function recordError(source: ErrorSource): void {
  const bucket = getBucket(currentMinute());
  bucket.counts[source]++;
}

export interface ErrorRateSnapshot {
  lastMinute: Record<ErrorSource, number>;
  lastHour: Record<ErrorSource, number>;
  total: Record<ErrorSource, number>;
}

export function getErrorRates(): ErrorRateSnapshot {
  const now = currentMinute();
  const sources: ErrorSource[] = ['spawn', 'handler', 'slack', 'cron'];

  const lastMinute: Record<ErrorSource, number> = { spawn: 0, handler: 0, slack: 0, cron: 0 };
  const lastHour: Record<ErrorSource, number> = { spawn: 0, handler: 0, slack: 0, cron: 0 };
  const total: Record<ErrorSource, number> = { spawn: 0, handler: 0, slack: 0, cron: 0 };

  for (const bucket of buckets) {
    if (bucket.minute < 0) continue;
    const age = now - bucket.minute;
    for (const src of sources) {
      const count = bucket.counts[src];
      total[src] += count;
      if (age <= 60) lastHour[src] += count;
      if (age <= 1) lastMinute[src] += count;
    }
  }

  return { lastMinute, lastHour, total };
}

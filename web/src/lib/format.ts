/** @fileoverview Display formatting utilities. */

export function shortUid(uid: string): string {
  const i = uid.indexOf('_');
  if (i === -1) return uid.slice(0, 10);
  return uid.slice(0, i + 1 + 7);
}

export function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatAge(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr + 'Z').getTime();
  return relativeAge(ms);
}

export function formatIsoAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  return relativeAge(ms);
}

function relativeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function timeStamp(): string {
  return new Date().toLocaleTimeString();
}

export function formatCountdown(isoDate: string): string {
  const ms = new Date(isoDate).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (hours < 24) return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function flightDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '-';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return '-';
  const secs = Math.round(ms / 1000);
  return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
}

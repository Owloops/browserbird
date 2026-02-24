/** @fileoverview SSE connection manager for real-time status updates and invalidation events. */

import type { StatusResponse, InvalidateEvent } from './types.ts';
import { apiBase, getAuthToken } from './api.ts';

let eventSource: EventSource | null = null;
let statusCallback: ((data: StatusResponse) => void) | null = null;
let invalidateCallback: ((data: InvalidateEvent) => void) | null = null;
let connectionCallback: ((state: 'connected' | 'disconnected') => void) | null = null;
let statusListener: ((e: MessageEvent) => void) | null = null;
let invalidateListener: ((e: MessageEvent) => void) | null = null;

export function connectSSE(
  onStatus: (data: StatusResponse) => void,
  onInvalidate?: (data: InvalidateEvent) => void,
  onConnection?: (state: 'connected' | 'disconnected') => void,
): void {
  disconnectSSE();
  statusCallback = onStatus;
  invalidateCallback = onInvalidate ?? null;
  connectionCallback = onConnection ?? null;

  const token = getAuthToken();
  const url = token
    ? `${apiBase}/api/events?token=${encodeURIComponent(token)}`
    : `${apiBase}/api/events`;
  eventSource = new EventSource(url);

  statusListener = (e: MessageEvent) => {
    connectionCallback?.('connected');
    try {
      const data = JSON.parse(e.data as string) as StatusResponse;
      statusCallback?.(data);
    } catch {
      /* malformed SSE data */
    }
  };

  invalidateListener = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data as string) as InvalidateEvent;
      invalidateCallback?.(data);
    } catch {
      /* malformed SSE data */
    }
  };

  eventSource.addEventListener('status', statusListener);
  eventSource.addEventListener('invalidate', invalidateListener);

  eventSource.onerror = () => {
    connectionCallback?.('disconnected');
  };

  eventSource.onopen = () => {
    connectionCallback?.('connected');
  };
}

export function disconnectSSE(): void {
  if (eventSource) {
    if (statusListener) {
      eventSource.removeEventListener('status', statusListener);
      statusListener = null;
    }
    if (invalidateListener) {
      eventSource.removeEventListener('invalidate', invalidateListener);
      invalidateListener = null;
    }
    eventSource.onerror = null;
    eventSource.onopen = null;
    eventSource.close();
    eventSource = null;
  }
  statusCallback = null;
  invalidateCallback = null;
  connectionCallback = null;
}

export function isSSEConnected(): boolean {
  return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}

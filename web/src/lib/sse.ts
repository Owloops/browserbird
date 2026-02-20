/** @fileoverview SSE connection manager for real-time status updates. */

import type { StatusResponse } from './types.ts';
import { getAuthToken } from './api.ts';

let eventSource: EventSource | null = null;
let statusCallback: ((data: StatusResponse) => void) | null = null;
let connectionCallback: ((state: 'connected' | 'disconnected') => void) | null = null;
let statusListener: ((e: MessageEvent) => void) | null = null;

export function connectSSE(
  onStatus: (data: StatusResponse) => void,
  onConnection?: (state: 'connected' | 'disconnected') => void,
): void {
  disconnectSSE();
  statusCallback = onStatus;
  connectionCallback = onConnection ?? null;

  const token = getAuthToken();
  const url = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events';
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

  eventSource.addEventListener('status', statusListener);

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
    eventSource.onerror = null;
    eventSource.onopen = null;
    eventSource.close();
    eventSource = null;
  }
  statusCallback = null;
  connectionCallback = null;
}

export function isSSEConnected(): boolean {
  return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}

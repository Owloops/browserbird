/** @fileoverview SSE connection manager with manual reconnect backoff. */

import type { StatusResponse, InvalidateEvent, ChatStreamEvent } from './types.ts';
import { apiBase, getAuthToken } from './api.ts';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_FACTOR = 2;

let eventSource: EventSource | null = null;
let statusCallback: ((data: StatusResponse) => void) | null = null;
let invalidateCallback: ((data: InvalidateEvent) => void) | null = null;
let connectionCallback: ((state: 'connected' | 'disconnected' | 'connecting') => void) | null =
  null;

const chatStreamListeners = new Set<(data: ChatStreamEvent) => void>();

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let stopped = false;

function buildURL(): string {
  const token = getAuthToken();
  return token
    ? `${apiBase}/api/events?token=${encodeURIComponent(token)}`
    : `${apiBase}/api/events`;
}

function scheduleReconnect(): void {
  if (stopped) return;
  if (reconnectTimer) return;

  connectionCallback?.('disconnected');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (stopped) return;
    connectionCallback?.('connecting');
    openSource();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * RECONNECT_FACTOR, RECONNECT_MAX_MS);
}

function openSource(): void {
  closeSource();

  const es = new EventSource(buildURL());
  eventSource = es;

  es.addEventListener('status', (e: MessageEvent) => {
    connectionCallback?.('connected');
    try {
      const data = JSON.parse(e.data as string) as StatusResponse;
      statusCallback?.(data);
    } catch {
      /* malformed SSE data */
    }
  });

  es.addEventListener('invalidate', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data as string) as InvalidateEvent;
      invalidateCallback?.(data);
    } catch {
      /* malformed SSE data */
    }
  });

  es.addEventListener('chat_stream', (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data as string) as ChatStreamEvent;
      for (const cb of chatStreamListeners) cb(data);
    } catch {
      /* malformed SSE data */
    }
  });

  es.onopen = () => {
    reconnectDelay = RECONNECT_MIN_MS;
    connectionCallback?.('connected');
  };

  es.onerror = () => {
    closeSource();
    scheduleReconnect();
  };
}

function closeSource(): void {
  if (!eventSource) return;
  eventSource.onerror = null;
  eventSource.onopen = null;
  eventSource.close();
  eventSource = null;
}

export function connectSSE(
  onStatus: (data: StatusResponse) => void,
  onInvalidate?: (data: InvalidateEvent) => void,
  onConnection?: (state: 'connected' | 'disconnected' | 'connecting') => void,
): void {
  disconnectSSE();
  stopped = false;
  statusCallback = onStatus;
  invalidateCallback = onInvalidate ?? null;
  connectionCallback = onConnection ?? null;
  openSource();
}

export function disconnectSSE(): void {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  closeSource();
  reconnectDelay = RECONNECT_MIN_MS;
  statusCallback = null;
  invalidateCallback = null;
  connectionCallback = null;
}

export function onChatStream(cb: (data: ChatStreamEvent) => void): () => void {
  chatStreamListeners.add(cb);
  return () => {
    chatStreamListeners.delete(cb);
  };
}

export function isSSEConnected(): boolean {
  return eventSource !== null && eventSource.readyState === EventSource.OPEN;
}

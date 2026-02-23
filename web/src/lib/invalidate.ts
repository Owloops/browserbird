/** @fileoverview Pub/sub for SSE invalidation events. Pages subscribe; App.svelte dispatches. */

import type { InvalidateEvent } from './types.ts';

type InvalidateHandler = (e: InvalidateEvent) => void;

const handlers = new Set<InvalidateHandler>();

export function onInvalidate(handler: InvalidateHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function dispatchInvalidate(e: InvalidateEvent): void {
  for (const h of handlers) h(e);
}

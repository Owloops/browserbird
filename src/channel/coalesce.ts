/** @fileoverview Debounces rapid-fire messages in group channels into single dispatches. */

export interface CoalescedMessage {
  userId: string;
  text: string;
  timestamp: string;
}

export interface CoalesceDispatch {
  channelId: string;
  threadTs: string;
  messages: CoalescedMessage[];
}

export type DispatchFn = (dispatch: CoalesceDispatch) => void;

interface PendingBatch {
  messages: CoalescedMessage[];
  timer: ReturnType<typeof setTimeout>;
}

export interface Coalescer {
  push(channelId: string, threadTs: string, userId: string, text: string, messageTs: string): void;
  flush(): void;
  destroy(): void;
}

export function createCoalescer(config: { debounceMs: number }, onDispatch: DispatchFn): Coalescer {
  const pending = new Map<string, PendingBatch>();

  function fire(key: string): void {
    const batch = pending.get(key);
    if (!batch) return;
    pending.delete(key);

    const [channelId, threadTs] = key.split(':') as [string, string];
    onDispatch({ channelId, threadTs, messages: batch.messages });
  }

  function push(
    channelId: string,
    threadTs: string,
    userId: string,
    text: string,
    messageTs: string,
  ): void {
    const key = `${channelId}:${threadTs}`;
    const message: CoalescedMessage = { userId, text, timestamp: messageTs };

    const existing = pending.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(message);
      existing.timer = setTimeout(() => fire(key), config.debounceMs);
    } else {
      const timer = setTimeout(() => fire(key), config.debounceMs);
      pending.set(key, { messages: [message], timer });
    }
  }

  function flush(): void {
    for (const key of [...pending.keys()]) {
      const batch = pending.get(key);
      if (batch) {
        clearTimeout(batch.timer);
      }
      fire(key);
    }
  }

  function destroy(): void {
    for (const batch of pending.values()) {
      clearTimeout(batch.timer);
    }
    pending.clear();
  }

  return { push, flush, destroy };
}

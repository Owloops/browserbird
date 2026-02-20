/** @fileoverview Reactive toast notification state using Svelte 5 runes. */

export type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export let toasts: Toast[] = $state([]);

export function showToast(message: string, type: ToastType = 'info'): void {
  const id = nextId++;
  toasts.push({ id, message, type });
  timers.set(
    id,
    setTimeout(() => dismissToast(id), 4000),
  );
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer != null) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const index = toasts.findIndex((t) => t.id === id);
  if (index !== -1) toasts.splice(index, 1);
}

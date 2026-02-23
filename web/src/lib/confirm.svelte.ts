/** @fileoverview Reactive confirm dialog state using Svelte 5 runes. */

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

interface ConfirmStore {
  pending: ConfirmState | null;
}

export const confirmStore: ConfirmStore = $state({ pending: null });

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmStore.pending = { message, resolve };
  });
}

export function confirmResolve(value: boolean): void {
  if (confirmStore.pending == null) return;
  const { resolve } = confirmStore.pending;
  confirmStore.pending = null;
  resolve(value);
}

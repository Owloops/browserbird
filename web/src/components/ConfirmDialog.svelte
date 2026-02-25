<script lang="ts">
  import { confirmStore, confirmResolve } from '../lib/confirm.svelte.ts';

  function onKeydown(e: KeyboardEvent): void {
    if (!confirmStore.pending) return;
    if (e.key === 'Escape') confirmResolve(false);
    if (e.key === 'Enter') confirmResolve(true);
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if confirmStore.pending}
  <div class="overlay">
    <button
      class="backdrop"
      type="button"
      onclick={() => confirmResolve(false)}
      aria-label="Close dialog"
    ></button>
    <div class="dialog" role="alertdialog" aria-modal="true">
      <p class="message">{confirmStore.pending.message}</p>
      <div class="actions">
        <button class="btn btn-outline btn-sm" onclick={() => confirmResolve(false)}>Cancel</button>
        <button class="btn btn-danger btn-sm" onclick={() => confirmResolve(true)}>Confirm</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    border: none;
    cursor: default;
  }

  .dialog {
    position: relative;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-5) var(--space-6);
    max-width: 360px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-shadow: var(--shadow-elevated);
  }

  .message {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-1-5);
  }
</style>

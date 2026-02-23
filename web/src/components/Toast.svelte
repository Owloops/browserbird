<script lang="ts">
  import { toasts, dismissToast } from '../lib/toast.svelte.ts';
</script>

<div class="toast-container">
  {#each toasts as toast (toast.id)}
    <div class="toast toast-{toast.type}">
      <span class="toast-message">{toast.message}</span>
      <button class="toast-close" aria-label="Dismiss" onclick={() => dismissToast(toast.id)}>
        &times;
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: var(--space-4);
    right: var(--space-4);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    min-width: 240px;
    max-width: 380px;
    animation: toast-in 0.15s ease;
  }

  .toast::before {
    font-size: var(--text-base);
    flex-shrink: 0;
  }

  .toast-success::before {
    content: '\2713';
    color: var(--color-success);
  }

  .toast-error::before {
    content: '\00d7';
    color: var(--color-error);
  }

  .toast-info::before {
    content: '\2022';
    color: var(--color-accent);
  }

  .toast-message {
    flex: 1;
  }

  .toast-close {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: var(--text-base);
    padding: 0;
    line-height: 1;
  }

  .toast-close:hover {
    color: var(--color-text-primary);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-0.5rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>

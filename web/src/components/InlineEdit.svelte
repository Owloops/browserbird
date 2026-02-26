<script lang="ts">
  interface Props {
    value: string;
    mono?: boolean;
    multiline?: boolean;
    placeholder?: string;
    saving?: boolean;
    onsave: (value: string) => void;
    oncancel: () => void;
  }

  let {
    value = $bindable(''),
    mono = false,
    multiline = false,
    placeholder,
    saving = false,
    onsave,
    oncancel,
  }: Props = $props();

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      oncancel();
    } else if (e.key === 'Enter') {
      if (multiline ? e.metaKey : !e.shiftKey) {
        e.preventDefault();
        onsave(value);
      }
    }
  }
</script>

<div class="inline-edit" class:inline-edit-multiline={multiline}>
  {#if multiline}
    <textarea
      class="inline-input inline-textarea"
      class:mono
      bind:value
      onkeydown={handleKeydown}
      {placeholder}
    ></textarea>
  {:else}
    <input
      class="inline-input"
      class:mono
      type="text"
      bind:value
      onkeydown={handleKeydown}
      {placeholder}
    />
  {/if}
  <div class="inline-actions">
    <button
      class="inline-btn inline-btn-save"
      disabled={saving}
      onclick={() => onsave(value)}
      title="Save"
    >
      {#if saving}...{:else}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
          ><path
            d="M3 8.5l3.5 3.5L13 4.5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          /></svg
        >{/if}
    </button>
    <button class="inline-btn inline-btn-cancel" onclick={oncancel} title="Cancel">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
        ><path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        /></svg
      >
    </button>
  </div>
</div>

<style>
  .inline-edit {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .inline-edit-multiline {
    flex-direction: column;
    align-items: stretch;
  }

  .inline-actions {
    display: flex;
    gap: var(--space-1);
  }

  .inline-edit-multiline .inline-actions {
    justify-content: flex-end;
  }

  .inline-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-1-5);
    background: var(--color-bg-deep);
    border: 1px solid var(--color-accent-dim);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.1);
  }

  .inline-input.mono {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .inline-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.18);
  }

  .inline-textarea {
    resize: none;
    height: 6rem;
    line-height: 1.5;
    overflow-y: auto;
  }

  .inline-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .inline-btn svg {
    width: 12px;
    height: 12px;
  }

  .inline-btn-save {
    background: var(--color-accent-dim);
    color: var(--color-text-primary);
  }

  .inline-btn-save:hover {
    background: var(--color-accent);
  }

  .inline-btn-save:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .inline-btn-cancel {
    background: transparent;
    color: var(--color-text-muted);
  }

  .inline-btn-cancel:hover {
    background: var(--color-bg-elevated);
    color: var(--color-text-secondary);
  }
</style>

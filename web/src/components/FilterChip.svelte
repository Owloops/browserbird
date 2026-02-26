<script lang="ts">
  interface Props {
    label: string;
    value: string;
    onClear: () => void;
  }

  let { label, value, onClear }: Props = $props();
</script>

<span class="chip">
  <span class="chip-label">{label}:</span>
  <span class="chip-value">{value}</span>
  <button class="chip-clear" onclick={onClear} aria-label="Clear filter">
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"
      ><path
        d="M3 3l6 6M9 3l-6 6"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      /></svg
    >
  </button>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-1) 2px var(--space-2);
    background: var(--color-accent-bg);
    border: 1px solid var(--color-accent-dim);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: nowrap;
  }

  .chip-label {
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .chip-value {
    color: var(--color-accent-glow);
    font-family: var(--font-mono);
    font-weight: 500;
  }

  .chip-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .chip-clear:hover {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
  }

  .chip-clear svg {
    width: 10px;
    height: 10px;
  }
</style>

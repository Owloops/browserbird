<script lang="ts">
  interface Props {
    active: boolean;
    onToggle: () => void;
  }

  let { active, onToggle }: Props = $props();
</script>

<div
  class="toggle"
  class:active
  role="switch"
  aria-checked={active}
  tabindex="0"
  onclick={onToggle}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  }}
></div>

<style>
  .toggle {
    position: relative;
    width: 34px;
    height: 20px;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    cursor: pointer;
    transition: all var(--transition-fast);
    flex-shrink: 0;
  }

  .toggle.active {
    background: var(--color-success);
    border-color: var(--color-success);
  }

  .toggle::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    background: var(--color-text-muted);
    border-radius: 50%;
    transition: transform var(--transition-fast);
  }

  .toggle.active::after {
    transform: translateX(14px);
    background: white;
  }
</style>

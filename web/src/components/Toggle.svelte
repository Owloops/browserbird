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
    width: 36px;
    height: 20px;
    background: var(--color-bg-hover);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition:
      background var(--transition-fast),
      box-shadow var(--transition-fast);
    flex-shrink: 0;
  }

  .toggle:hover {
    background: var(--color-border);
  }

  .toggle.active {
    background: var(--color-success);
  }

  .toggle.active:hover {
    background: color-mix(in srgb, var(--color-success) 85%, white);
  }

  .toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    background: var(--color-text-muted);
    border-radius: 50%;
    transition:
      transform var(--transition-fast),
      background var(--transition-fast);
    box-shadow: var(--shadow-sm);
  }

  .toggle.active::after {
    transform: translateX(16px);
    background: white;
  }
</style>

<script lang="ts">
  interface Props {
    label: string;
    value: string | number;
    sub?: string;
    variant?: 'info' | 'warning' | 'success' | 'error';
  }

  let { label, value, sub, variant }: Props = $props();
</script>

<div
  class="stat-card"
  class:stat-card-info={variant === 'info'}
  class:stat-card-warning={variant === 'warning'}
  class:stat-card-success={variant === 'success'}
  class:stat-card-error={variant === 'error'}
>
  <div class="card-label">{label}</div>
  <div class="card-value">{value}</div>
  {#if sub}
    <div class="card-sub">{sub}</div>
  {/if}
</div>

<style>
  .stat-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0.733rem 0.867rem;
  }

  .card-label {
    font-size: 0.733rem;
    font-weight: 500;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.2rem;
  }

  .card-value {
    font-family: var(--font-mono);
    font-size: 1.333rem;
    font-weight: 600;
    color: var(--color-text-primary);
    line-height: 1.2;
  }

  .card-sub {
    font-size: 0.733rem;
    color: var(--color-text-muted);
    margin-top: 0.2rem;
  }

  .stat-card-info .card-value {
    color: var(--color-accent-glow);
  }

  .stat-card-warning .card-value {
    color: var(--color-warning);
  }

  .stat-card-success .card-value {
    color: var(--color-success);
  }

  .stat-card-error .card-value {
    color: var(--color-error);
  }
</style>

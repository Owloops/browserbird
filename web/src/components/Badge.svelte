<script lang="ts">
  interface Props {
    status: string;
  }

  const CLASS_MAP: Record<string, string> = {
    pending: 'badge-warning',
    running: 'badge-accent',
    completed: 'badge-success',
    failed: 'badge-error',
    success: 'badge-success',
    error: 'badge-error',
    triggered: 'badge-accent',
    debug: 'badge-muted',
    info: 'badge-accent',
    warn: 'badge-warning',
  };

  let { status }: Props = $props();
  const badgeClass = $derived(CLASS_MAP[status] ?? 'badge-muted');
</script>

<span class="badge {badgeClass}">{status}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.4;
  }

  .badge-success {
    color: var(--color-success);
    background: var(--color-success-bg);
  }

  .badge-warning {
    color: var(--color-warning);
    background: var(--color-warning-bg);
  }

  .badge-error {
    color: var(--color-error);
    background: var(--color-error-bg);
  }

  .badge-accent {
    color: var(--color-accent-glow);
    background: var(--color-accent-bg);
  }

  .badge-muted {
    color: var(--color-text-muted);
    background: rgba(92, 101, 115, 0.1);
  }
</style>

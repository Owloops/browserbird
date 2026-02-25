<script lang="ts">
  import type { StatusResponse } from '../lib/types.ts';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let open = $state(false);

  interface ServiceEntry {
    label: string;
    ok: boolean;
    detail: string;
    applicable: boolean;
  }

  const services = $derived.by((): ServiceEntry[] => {
    if (!status) return [];
    return [
      {
        label: 'Agent CLI',
        ok: status.agent.available,
        detail: status.agent.available ? 'ready' : 'not found',
        applicable: true,
      },
      {
        label: 'Slack',
        ok: status.slack.connected,
        detail: status.slack.connected ? 'connected' : 'disconnected',
        applicable: true,
      },
      {
        label: 'Browser',
        ok: status.browser.connected,
        detail: status.browser.connected ? 'connected' : 'unreachable',
        applicable: status.browser.enabled,
      },
    ];
  });

  const applicableServices = $derived(services.filter((s) => s.applicable));
  const allUp = $derived(applicableServices.length > 0 && applicableServices.every((s) => s.ok));
  const allDown = $derived(
    applicableServices.length === 0 || applicableServices.every((s) => !s.ok),
  );
  const aggregateLevel = $derived(allUp ? 'ok' : allDown ? 'err' : 'warn');

  function toggle(): void {
    open = !open;
  }

  function handleClickOutside(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.closest('.svc-status')) {
      open = false;
    }
  }

  $effect(() => {
    if (!open) return;
    document.addEventListener('click', handleClickOutside, true);
    return () => document.removeEventListener('click', handleClickOutside, true);
  });
</script>

<div class="svc-status">
  <button class="svc-btn" onclick={toggle} title="Service status">
    <span
      class="svc-dot"
      class:svc-ok={aggregateLevel === 'ok'}
      class:svc-warn={aggregateLevel === 'warn'}
      class:svc-err={aggregateLevel === 'err'}
    ></span>
  </button>
  {#if open}
    <div class="svc-popover">
      {#each services as svc (svc.label)}
        <div class="svc-row" class:svc-row-disabled={!svc.applicable}>
          <span
            class="svc-row-dot"
            class:svc-ok={svc.applicable && svc.ok}
            class:svc-err={svc.applicable && !svc.ok}
            class:svc-off={!svc.applicable}
          ></span>
          <span class="svc-row-label">{svc.label}</span>
          <span class="svc-row-detail mono">{svc.applicable ? svc.detail : 'disabled'}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .svc-status {
    position: relative;
  }

  .svc-btn {
    display: flex;
    align-items: center;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);
  }

  .svc-btn:hover {
    background: var(--color-bg-hover);
  }

  .svc-dot {
    width: var(--dot-size);
    height: var(--dot-size);
    border-radius: 50%;
    transition:
      background var(--transition-normal),
      box-shadow var(--transition-normal);
  }

  .svc-ok {
    background: var(--color-success);
    box-shadow: 0 0 4px var(--color-success);
  }

  .svc-warn {
    background: var(--color-warning);
    box-shadow: 0 0 4px var(--color-warning);
  }

  .svc-err {
    background: var(--color-error);
    box-shadow: 0 0 4px var(--color-error);
  }

  .svc-off {
    background: var(--color-text-muted);
    box-shadow: none;
  }

  .svc-popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    background: color-mix(in srgb, var(--color-bg-deep) 92%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-2-5) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    z-index: 100;
    min-width: 200px;
    box-shadow: var(--shadow-elevated);
  }

  .svc-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }

  .svc-row-disabled {
    opacity: 0.4;
  }

  .svc-row-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .svc-row-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    flex: 1;
  }

  .svc-row-detail {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  @media (max-width: 768px) {
    .svc-popover {
      min-width: 0;
      right: calc(-1 * var(--space-2));
      max-width: calc(100vw - 2 * var(--space-3));
    }
  }
</style>

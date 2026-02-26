<script lang="ts">
  import type { FlightRow } from '../lib/types.ts';
  import { formatAge, flightDuration } from '../lib/format.ts';

  interface Props {
    flight: FlightRow;
    expanded: boolean;
    ontoggle: () => void;
    onretry: () => void;
  }

  let { flight, expanded, ontoggle, onretry }: Props = $props();

  function statusDotClass(status: string): string {
    if (status === 'success') return 'dot-ok';
    if (status === 'error') return 'dot-err';
    return 'dot-running';
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ontoggle();
    }
  }
</script>

<div
  class="flight-card"
  class:flight-expanded={expanded}
  role="button"
  tabindex="0"
  onclick={ontoggle}
  onkeydown={handleKeydown}
>
  <div class="flight-top">
    <span class="svc-dot {statusDotClass(flight.status)}"></span>
    <span class="flight-duration mono">{flightDuration(flight.started_at, flight.finished_at)}</span
    >
    <span class="flight-age">{formatAge(flight.started_at)}</span>
  </div>
  {#if flight.error || flight.result}
    <div class="flight-summary">
      {flight.error ?? flight.result ?? ''}
    </div>
  {/if}
  {#if expanded}
    <div class="flight-detail">
      {#if flight.error}
        <p class="detail-label error-label">Error</p>
        <pre class="detail-pre error-pre">{flight.error}</pre>
      {/if}
      {#if flight.result}
        <p class="detail-label">Result</p>
        <pre class="detail-pre">{flight.result}</pre>
      {/if}
      {#if flight.status === 'error'}
        <button
          class="btn btn-outline btn-sm retry-btn"
          onclick={(e) => {
            e.stopPropagation();
            onretry();
          }}>Retry</button
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .flight-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-2-5) var(--space-3);
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast);
  }

  .flight-card:hover {
    border-color: var(--color-border-subtle);
    background: var(--color-bg-hover);
  }

  .flight-expanded {
    border-left-width: 3px;
    border-left-color: var(--color-accent-dim);
  }

  .flight-card:has(.svc-dot.dot-ok).flight-expanded {
    border-left-color: var(--color-success);
  }

  .flight-card:has(.svc-dot.dot-err).flight-expanded {
    border-left-color: var(--color-error);
  }

  .flight-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .svc-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-ok {
    background: var(--color-success);
    box-shadow: 0 0 6px rgba(62, 201, 122, 0.5);
  }

  .dot-err {
    background: var(--color-error);
    box-shadow: 0 0 6px rgba(224, 92, 92, 0.5);
  }

  .dot-running {
    background: var(--color-accent);
    box-shadow: 0 0 6px rgba(91, 140, 240, 0.5);
  }

  .flight-duration {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .flight-age {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-left: auto;
  }

  .flight-summary {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .flight-detail {
    padding-top: var(--space-1-5);
  }

  .detail-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 var(--space-1) 0;
  }

  .error-label {
    color: var(--color-error);
  }

  .detail-pre {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: var(--color-bg-deep);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0 0 var(--space-2) 0;
    max-height: 240px;
    overflow-y: auto;
  }

  .error-pre {
    color: var(--color-error);
  }

  .retry-btn {
    margin-top: var(--space-1);
  }
</style>

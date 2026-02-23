<script lang="ts">
  import type { PaginatedResult, FlightRow } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge } from '../lib/format.ts';
  import { onInvalidate } from '../lib/invalidate.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';

  const PER_PAGE = 20;

  let flights: FlightRow[] = $state([]);
  let totalPages = $state(1);
  let totalItems = $state(0);
  let page = $state(1);
  let loading = $state(true);
  let statusFilter = $state('');
  let expandedId: number | null = $state(null);

  type SortKey = 'id' | 'duration';
  type SortDir = 'asc' | 'desc';
  let sortBy: SortKey = $state('id');
  let sortDir: SortDir = $state('desc');

  async function fetchFlights(
    p: number,
    status: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('perPage', String(PER_PAGE));
      if (status) params.set('status', status);
      const data = await api<PaginatedResult<FlightRow>>(`/api/flights?${params.toString()}`);
      if (signal.aborted) return;
      flights = data.items;
      totalPages = data.totalPages;
      totalItems = data.totalItems;
    } catch {
      /* connection check handles display */
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  $effect(() => {
    const p = page;
    const status = statusFilter;
    const ac = new AbortController();
    loading = true;
    fetchFlights(p, status, ac.signal);
    const unsub = onInvalidate((e) => {
      if (e.resource === 'birds') fetchFlights(p, status, ac.signal);
    });
    return () => {
      ac.abort();
      unsub();
    };
  });

  function resetPage(): void {
    page = 1;
  }

  function toggleSort(key: SortKey): void {
    if (sortBy === key) {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      sortBy = key;
      sortDir = 'desc';
    }
  }

  const sortedFlights = $derived.by(() => {
    const items = [...flights];
    if (sortBy === 'duration') {
      items.sort((a, b) => {
        const durationMs = (f: FlightRow) =>
          f.finished_at
            ? new Date(f.finished_at).getTime() - new Date(f.started_at).getTime()
            : -1;
        const diff = durationMs(a) - durationMs(b);
        return sortDir === 'asc' ? diff : -diff;
      });
    } else {
      items.sort((a, b) => (sortDir === 'asc' ? a.id - b.id : b.id - a.id));
    }
    return items;
  });

  function flightDuration(startedAt: string, finishedAt: string | null): string {
    if (!finishedAt) return '—';
    const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 0) return '—';
    const secs = Math.round(ms / 1000);
    return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  }

  function sortLabel(key: SortKey): string {
    if (sortBy !== key) return '';
    return sortDir === 'desc' ? ' ↓' : ' ↑';
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <div class="filter-bar">
    <select
      class="filter-select"
      bind:value={statusFilter}
      onchange={resetPage}
    >
      <option value="">All statuses</option>
      <option value="success">Success</option>
      <option value="error">Error</option>
      <option value="running">Running</option>
    </select>
  </div>

  <DataTable
    columns={['#', 'Bird', 'Status', 'Duration', 'Started', 'Error / Result']}
    isEmpty={sortedFlights.length === 0}
    emptyMessage="No flights recorded"
    {page}
    {totalPages}
    {totalItems}
    onPageChange={(p) => {
      page = p;
    }}
  >
    {#snippet header()}
      <tr>
        <th>
          <button class="sort-btn" onclick={() => toggleSort('id')}>#{ sortLabel('id')}</button>
        </th>
        <th>Bird</th>
        <th>Status</th>
        <th>
          <button class="sort-btn" onclick={() => toggleSort('duration')}>Duration{sortLabel('duration')}</button>
        </th>
        <th>Started</th>
        <th>Error / Result</th>
      </tr>
    {/snippet}
    {#each sortedFlights as flight (flight.id)}
      <tr
        class="flight-row"
        class:flight-expanded={expandedId === flight.id}
        onclick={() => { expandedId = expandedId === flight.id ? null : flight.id; }}
      >
        <td class="mono">#{flight.id}</td>
        <td>
          <a
            class="bird-link"
            href="#/birds"
            onclick={(e) => e.stopPropagation()}
          >{flight.bird_name}</a>
        </td>
        <td><Badge status={flight.status} /></td>
        <td class="mono">{flightDuration(flight.started_at, flight.finished_at)}</td>
        <td>{formatAge(flight.started_at)}</td>
        <td class="summary-cell">{flight.error ?? flight.result ?? '—'}</td>
      </tr>
      {#if expandedId === flight.id && (flight.result || flight.error)}
        <tr class="detail-row">
          <td colspan="6">
            <div class="detail-content">
              {#if flight.error}
                <p class="detail-label error-label">Error</p>
                <pre class="detail-pre error-pre">{flight.error}</pre>
              {/if}
              {#if flight.result}
                <p class="detail-label">Result</p>
                <pre class="detail-pre">{flight.result}</pre>
              {/if}
            </div>
          </td>
        </tr>
      {/if}
    {/each}
  </DataTable>
{/if}

<style>
  .filter-bar {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    align-items: center;
  }

  .filter-select {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
  }

  .sort-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0;
    white-space: nowrap;
  }

  .sort-btn:hover {
    color: var(--color-text-primary);
  }

  .flight-row {
    cursor: pointer;
  }

  .flight-row:hover td {
    background: var(--color-bg-elevated);
  }

  .flight-expanded td {
    background: var(--color-bg-elevated);
  }

  .bird-link {
    color: var(--color-accent);
    text-decoration: none;
    font-size: var(--text-sm);
  }

  .bird-link:hover {
    color: var(--color-accent-glow);
  }

  .summary-cell {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .detail-row td {
    padding: 0;
    background: var(--color-bg-deep);
  }

  .detail-content {
    padding: var(--space-3) var(--space-4);
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
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0 0 var(--space-2) 0;
    max-height: 300px;
    overflow-y: auto;
  }

  .error-pre {
    color: var(--color-error);
  }
</style>

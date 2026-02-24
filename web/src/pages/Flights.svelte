<script lang="ts">
  import type { ColumnDef, FlightRow } from '../lib/types.ts';
  import { createDataTable } from '../lib/data-table.svelte.ts';
  import { formatAge } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';
  import Toggle from '../components/Toggle.svelte';

  const columns: ColumnDef[] = [
    { key: 'id', label: '#', sortable: true },
    { key: 'bird_name', label: 'Bird', sortable: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'started_at', label: 'Duration', sortable: false },
    { key: 'started_at_time', label: 'Started', sortable: true },
    { key: 'error', label: 'Error / Result' },
  ];

  let statusFilter = $state('');
  let showSystem = $state(localStorage.getItem('flights-show-system') === 'true');
  let expandedId: number | null = $state(null);

  const table = createDataTable<FlightRow>({
    endpoint: '/api/flights',
    columns,
    defaultSort: '-id',
    invalidateOn: 'birds',
    buildParams: () => {
      const p: Record<string, string> = {};
      if (statusFilter) p['status'] = statusFilter;
      if (showSystem) p['system'] = 'true';
      return p;
    },
    watchExtras: () => `${statusFilter}|${showSystem}`,
  });

  function flightDuration(startedAt: string, finishedAt: string | null): string {
    if (!finishedAt) return '-';
    const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 0) return '-';
    const secs = Math.round(ms / 1000);
    return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  }

  function resetPage(): void {
    table.setPage(1);
  }
</script>

{#if table.loading}
  <div class="loading">Loading...</div>
{:else}
  <DataTable
    {columns}
    isEmpty={table.items.length === 0}
    emptyMessage="No flights recorded"
    fetching={table.fetching}
    page={table.page}
    totalPages={table.totalPages}
    totalItems={table.totalItems}
    sort={table.sort}
    search={table.search}
    searchPlaceholder="Search flights..."
    onPageChange={table.setPage}
    onSortChange={table.setSort}
    onSearchChange={table.setSearch}
  >
    {#snippet toolbar()}
      <select class="filter-select" bind:value={statusFilter} onchange={resetPage}>
        <option value="">All statuses</option>
        <option value="success">Success</option>
        <option value="error">Error</option>
        <option value="running">Running</option>
      </select>
      <div class="system-toggle">
        <Toggle
          active={showSystem}
          onToggle={() => {
            showSystem = !showSystem;
            localStorage.setItem('flights-show-system', String(showSystem));
            table.setPage(1);
          }}
        />
        <span>System flights</span>
      </div>
    {/snippet}
    {#each table.items as flight (flight.id)}
      <tr
        class="flight-row"
        class:flight-expanded={expandedId === flight.id}
        onclick={() => {
          expandedId = expandedId === flight.id ? null : flight.id;
        }}
      >
        <td class="mono">#{flight.id}</td>
        <td>
          <a class="bird-link" href="#/birds" onclick={(e) => e.stopPropagation()}
            >{flight.bird_name}</a
          >
        </td>
        <td><Badge status={flight.status} /></td>
        <td class="mono">{flightDuration(flight.started_at, flight.finished_at)}</td>
        <td>{formatAge(flight.started_at)}</td>
        <td class="summary-cell">{flight.error ?? flight.result ?? '-'}</td>
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

  .system-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    user-select: none;
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

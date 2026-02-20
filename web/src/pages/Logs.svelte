<script lang="ts">
  import type { PaginatedResult, LogRow } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge, timeStamp } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';

  const PER_PAGE = 50;

  let logs: LogRow[] = $state([]);
  let totalPages = $state(1);
  let totalItems = $state(0);
  let page = $state(1);
  let loading = $state(true);
  let levelFilter = $state('');
  let lastUpdated = $state(timeStamp());

  async function fetchLogs(level: string, p: number, signal: AbortSignal): Promise<void> {
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('perPage', String(PER_PAGE));
      if (level) params.set('level', level);
      const data = await api<PaginatedResult<LogRow>>(`/api/logs?${params.toString()}`);
      if (signal.aborted) return;
      logs = data.items;
      totalPages = data.totalPages;
      totalItems = data.totalItems;
      lastUpdated = timeStamp();
    } catch {
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  $effect(() => {
    const level = levelFilter;
    const p = page;
    const ac = new AbortController();
    fetchLogs(level, p, ac.signal);
    const timer = setInterval(() => fetchLogs(level, p, ac.signal), 10_000);
    return () => {
      ac.abort();
      clearInterval(timer);
    };
  });

  function resetPage(): void {
    page = 1;
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <div class="filter-bar">
    <select bind:value={levelFilter} onchange={resetPage}>
      <option value="">All Levels</option>
      <option value="debug">Debug</option>
      <option value="info">Info</option>
      <option value="warn">Warn</option>
      <option value="error">Error</option>
    </select>
    <div class="filter-spacer"></div>
    <span class="last-updated">Updated {lastUpdated}</span>
  </div>

  <DataTable
    columns={['Level', 'Source', 'Message', 'Channel', 'Time']}
    isEmpty={logs.length === 0}
    emptyMessage="No logs recorded"
    {page}
    {totalPages}
    {totalItems}
    onPageChange={(p) => {
      page = p;
    }}
  >
    {#each logs as log (log.id)}
      <tr>
        <td><Badge status={log.level} /></td>
        <td class="mono">{log.source}</td>
        <td class="log-message">{log.message}</td>
        <td class="mono">{log.channel_id ?? '—'}</td>
        <td>{formatAge(log.created_at)}</td>
      </tr>
    {/each}
  </DataTable>
{/if}

<style>
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    align-items: center;
  }

  .filter-bar select {
    padding: 0.3rem 0.625rem;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: 0.769rem;
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .filter-bar select:focus {
    border-color: var(--color-accent-dim);
    outline: none;
  }

  .filter-spacer {
    flex: 1;
  }

  .last-updated {
    font-size: 0.615rem;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .log-message {
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

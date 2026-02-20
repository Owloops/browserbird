<script lang="ts">
  import type { PaginatedResult, JobRow, JobStats, StatusResponse } from '../lib/types.ts';
  import { api, getHashParams } from '../lib/api.ts';
  import { formatAge, timeStamp } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import StatCard from '../components/StatCard.svelte';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';

  const PER_PAGE = 20;

  interface Props {
    sseJobs: StatusResponse['jobs'] | null;
  }

  let { sseJobs }: Props = $props();

  const initialParams = getHashParams();

  let jobs: JobRow[] = $state([]);
  let stats: JobStats = $state({ pending: 0, running: 0, completed: 0, failed: 0, total: 0 });
  let totalPages = $state(1);
  let totalItems = $state(0);
  let page = $state(1);
  let loading = $state(true);
  let statusFilter = $state('');
  let cronJobIdFilter = $state(initialParams.get('cronJobId') ?? '');
  let nameFilter = $state('');
  let lastUpdated = $state(timeStamp());

  const displayStats = $derived(sseJobs ?? stats);

  interface FetchFilters {
    status: string;
    cronJobId: string;
    name: string;
  }

  async function fetchAll(filters: FetchFilters, p: number, signal: AbortSignal): Promise<void> {
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('perPage', String(PER_PAGE));
      if (filters.status) params.set('status', filters.status);
      if (filters.cronJobId) params.set('cronJobId', filters.cronJobId);
      if (filters.name) params.set('name', filters.name);
      const [fetchedStats, result] = await Promise.all([
        api<JobStats>('/api/jobs/stats'),
        api<PaginatedResult<JobRow>>(`/api/jobs?${params.toString()}`),
      ]);
      if (signal.aborted) return;
      stats = fetchedStats;
      jobs = result.items;
      totalPages = result.totalPages;
      totalItems = result.totalItems;
      lastUpdated = timeStamp();
    } catch {
      /* connection check handles display */
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  $effect(() => {
    const filters: FetchFilters = {
      status: statusFilter,
      cronJobId: cronJobIdFilter,
      name: nameFilter,
    };
    const p = page;
    const ac = new AbortController();
    fetchAll(filters, p, ac.signal);
    const timer = setInterval(() => fetchAll(filters, p, ac.signal), 15_000);
    return () => {
      ac.abort();
      clearInterval(timer);
    };
  });

  function refresh(): Promise<void> {
    return fetchAll(
      { status: statusFilter, cronJobId: cronJobIdFilter, name: nameFilter },
      page,
      new AbortController().signal,
    );
  }

  async function retryJob(id: number): Promise<void> {
    try {
      await api(`/api/jobs/${id}/retry`, { method: 'POST' });
      showToast(`Job #${id} queued for retry`, 'success');
      await refresh();
    } catch (err) {
      showToast(`Failed to retry: ${(err as Error).message}`, 'error');
    }
  }

  async function deleteJob(id: number): Promise<void> {
    try {
      await api(`/api/jobs/${id}`, { method: 'DELETE' });
      showToast(`Job #${id} deleted`, 'success');
      await refresh();
    } catch (err) {
      showToast(`Failed to delete: ${(err as Error).message}`, 'error');
    }
  }

  async function retryAllFailed(): Promise<void> {
    try {
      const result = await api<{ count: number }>('/api/jobs/retry-all', { method: 'POST' });
      showToast(`${result.count} failed job(s) queued for retry`, 'success');
      await refresh();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function clearCompleted(): Promise<void> {
    try {
      const result = await api<{ count: number }>('/api/jobs/clear?status=completed', {
        method: 'DELETE',
      });
      showToast(`${result.count} completed job(s) cleared`, 'success');
      await refresh();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function clearFailed(): Promise<void> {
    try {
      const result = await api<{ count: number }>('/api/jobs/clear?status=failed', {
        method: 'DELETE',
      });
      showToast(`${result.count} failed job(s) cleared`, 'success');
      await refresh();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function resetPage(): void {
    page = 1;
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <div class="stat-cards">
    <StatCard label="Pending" value={displayStats.pending} variant="info" />
    <StatCard label="Running" value={displayStats.running} variant="warning" />
    <StatCard label="Completed" value={displayStats.completed} variant="success" />
    <StatCard label="Failed" value={displayStats.failed} variant="error" />
  </div>

  <div class="page-header">
    <div class="page-header-actions">
      <button
        class="btn btn-outline btn-sm"
        disabled={displayStats.failed === 0}
        onclick={retryAllFailed}>Retry All Failed</button
      >
      <button
        class="btn btn-outline btn-sm"
        disabled={displayStats.completed === 0}
        onclick={clearCompleted}>Clear Completed</button
      >
      <button
        class="btn btn-outline btn-sm"
        disabled={displayStats.failed === 0}
        onclick={clearFailed}>Clear Failed</button
      >
    </div>
  </div>

  <div class="filter-bar">
    <select bind:value={statusFilter} onchange={resetPage}>
      <option value="">All Status</option>
      <option value="pending">Pending</option>
      <option value="running">Running</option>
      <option value="completed">Completed</option>
      <option value="failed">Failed</option>
    </select>
    <input
      class="filter-input"
      type="text"
      placeholder="Bird ID"
      bind:value={cronJobIdFilter}
      oninput={resetPage}
    />
    <input
      class="filter-input"
      type="text"
      placeholder="Name"
      bind:value={nameFilter}
      oninput={resetPage}
    />
    {#if cronJobIdFilter || nameFilter}
      <button
        class="btn btn-outline btn-sm"
        onclick={() => {
          cronJobIdFilter = '';
          nameFilter = '';
          resetPage();
        }}>Clear</button
      >
    {/if}
    <div class="filter-spacer"></div>
    <span class="last-updated">Updated {lastUpdated}</span>
  </div>

  <DataTable
    columns={['ID', 'Name', 'Status', 'Attempts', 'Error', 'Created', 'Actions']}
    isEmpty={jobs.length === 0}
    emptyMessage="No {statusFilter || ''} jobs in queue"
    {page}
    {totalPages}
    {totalItems}
    onPageChange={(p) => {
      page = p;
    }}
  >
    {#each jobs as j (j.id)}
      <tr>
        <td class="mono">{j.id}</td>
        <td>{j.name}</td>
        <td><Badge status={j.status} /></td>
        <td class="mono">{j.attempts}/{j.max_attempts}</td>
        <td>
          {#if j.error}
            <Badge status="error" />{' '}{j.error.slice(0, 50)}{j.error.length > 50 ? '...' : ''}
          {:else}
            —
          {/if}
        </td>
        <td>{formatAge(j.created_at)}</td>
        <td>
          <div class="actions-cell">
            {#if j.status === 'failed'}
              <button class="btn btn-outline btn-sm" onclick={() => retryJob(j.id)}>Retry</button>
            {/if}
            <button class="btn btn-danger btn-sm" onclick={() => deleteJob(j.id)}>Delete</button>
          </div>
        </td>
      </tr>
    {/each}
  </DataTable>
{/if}

<style>
  .stat-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.625rem;
    margin-bottom: 1rem;
  }

  .page-header {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    margin-bottom: 0.75rem;
    gap: 0.75rem;
  }

  .page-header-actions {
    display: flex;
    gap: 0.375rem;
  }

  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    align-items: center;
  }

  .filter-bar select {
    padding: 0.4rem 0.7rem;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: 0.867rem;
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .filter-bar select:focus {
    border-color: var(--color-accent-dim);
    outline: none;
  }

  .filter-input {
    padding: 0.4rem 0.7rem;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: 0.867rem;
    font-family: var(--font-mono);
    width: 7rem;
  }

  .filter-input:focus {
    border-color: var(--color-accent-dim);
    outline: none;
  }

  .filter-input::placeholder {
    color: var(--color-text-muted);
  }

  .filter-spacer {
    flex: 1;
  }

  .last-updated {
    font-size: 0.733rem;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .actions-cell {
    display: flex;
    gap: 0.25rem;
  }

  @media (max-width: 768px) {
    .stat-cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>

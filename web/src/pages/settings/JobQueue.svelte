<script lang="ts">
  import type { JobStats } from '../../lib/types.ts';
  import { api } from '../../lib/api.ts';
  import { showToast } from '../../lib/toast.svelte.ts';

  interface Props {
    initialStats: JobStats | null;
  }

  let { initialStats }: Props = $props();

  let jobStats: JobStats | null = $state(null);
  $effect(() => {
    if (initialStats != null) jobStats = initialStats;
  });
  let retryingFailed = $state(false);
  let clearingCompleted = $state(false);
  let clearingFailed = $state(false);

  async function refreshStats(): Promise<void> {
    jobStats = await api<JobStats>('/api/jobs/stats');
  }

  async function retryAllFailed(): Promise<void> {
    retryingFailed = true;
    try {
      const result = await api<{ count: number }>('/api/jobs/retry-all', { method: 'POST' });
      showToast(`${result.count} failed job(s) queued for retry`, 'success');
      await refreshStats();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      retryingFailed = false;
    }
  }

  async function clearCompleted(): Promise<void> {
    clearingCompleted = true;
    try {
      const result = await api<{ count: number }>('/api/jobs/clear?status=completed', {
        method: 'DELETE',
      });
      showToast(`${result.count} completed job(s) cleared`, 'success');
      await refreshStats();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      clearingCompleted = false;
    }
  }

  async function clearFailed(): Promise<void> {
    clearingFailed = true;
    try {
      const result = await api<{ count: number }>('/api/jobs/clear?status=failed', {
        method: 'DELETE',
      });
      showToast(`${result.count} failed job(s) cleared`, 'success');
      await refreshStats();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      clearingFailed = false;
    }
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Job Queue</span>
    {#if jobStats}
      <span class="queue-summary mono">
        {jobStats.total} total
      </span>
    {/if}
  </div>
  <div class="panel-body">
    {#if jobStats}
      <div class="stat-row">
        <div class="stat-cell">
          <span class="stat-num">{jobStats.pending}</span>
          <span class="stat-lbl">pending</span>
        </div>
        <div class="stat-cell">
          <span class="stat-num stat-num-active">{jobStats.running}</span>
          <span class="stat-lbl">running</span>
        </div>
        <div class="stat-cell">
          <span class="stat-num stat-num-ok">{jobStats.completed}</span>
          <span class="stat-lbl">completed</span>
        </div>
        <div class="stat-cell">
          <span class="stat-num stat-num-err">{jobStats.failed}</span>
          <span class="stat-lbl">failed</span>
        </div>
      </div>
    {/if}
    <div class="action-row">
      <button
        class="btn btn-outline btn-sm"
        disabled={retryingFailed || (jobStats?.failed ?? 0) === 0}
        onclick={retryAllFailed}>{retryingFailed ? 'Retrying...' : 'Retry Failed'}</button
      >
      <button
        class="btn btn-outline btn-sm"
        disabled={clearingCompleted || (jobStats?.completed ?? 0) === 0}
        onclick={clearCompleted}>{clearingCompleted ? 'Clearing...' : 'Clear Completed'}</button
      >
      <button
        class="btn btn-outline btn-sm"
        disabled={clearingFailed || (jobStats?.failed ?? 0) === 0}
        onclick={clearFailed}>{clearingFailed ? 'Clearing...' : 'Clear Failed'}</button
      >
    </div>
  </div>
</div>

<style>
  .queue-summary {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .stat-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid var(--color-border);
  }

  .stat-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-2);
    border-right: 1px solid rgba(35, 42, 53, 0.5);
  }

  .stat-cell:last-child {
    border-right: none;
  }

  .stat-num {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .stat-num-active {
    color: var(--color-accent);
  }

  .stat-num-ok {
    color: var(--color-success);
  }

  .stat-num-err {
    color: var(--color-error);
  }

  .stat-lbl {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .action-row {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2-5) var(--space-4);
  }

  @media (max-width: 480px) {
    .stat-row {
      grid-template-columns: repeat(2, 1fr);
    }

    .stat-cell:nth-child(2) {
      border-right: none;
    }

    .stat-cell:nth-child(-n + 2) {
      border-bottom: 1px solid rgba(35, 42, 53, 0.5);
    }

    .action-row {
      flex-wrap: wrap;
    }
  }
</style>

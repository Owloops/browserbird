<script lang="ts">
  import type { JobStats, CronJobRow, LogRow } from '../../lib/types.ts';
  import { formatAge } from '../../lib/format.ts';
  import JobQueue from './JobQueue.svelte';
  import SystemBirds from './SystemBirds.svelte';

  interface Props {
    jobStats: JobStats | null;
    systemBirds: CronJobRow[];
    recentErrors: LogRow[];
  }

  let { jobStats, systemBirds, recentErrors }: Props = $props();
</script>

<div class="db-grid">
  <JobQueue initialStats={jobStats} />
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Recent Errors</span>
      {#if recentErrors.length > 0}
        <span class="error-count">{recentErrors.length}</span>
      {/if}
    </div>
    <div class="panel-body">
      {#if recentErrors.length === 0}
        <div class="row"><span class="dim">No errors recorded</span></div>
      {:else}
        {#each recentErrors as error (error.id)}
          <div class="error-entry">
            <div class="error-top">
              <span class="error-source mono">{error.source}</span>
              <span class="error-time">{formatAge(error.created_at)}</span>
            </div>
            <span class="error-message">{error.message}</span>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<SystemBirds birds={systemBirds} />

<style>
  .db-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .error-count {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--color-error);
    background: var(--color-error-bg);
    padding: 1px var(--space-1-5);
    border-radius: var(--radius-full);
    min-width: 1.25rem;
    text-align: center;
  }

  .error-entry {
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid rgba(35, 42, 53, 0.5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .error-entry:last-child {
    border-bottom: none;
  }

  .error-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .error-source {
    color: var(--color-error);
    font-size: var(--text-xs);
  }

  .error-message {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .error-time {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  @media (max-width: 960px) {
    .db-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

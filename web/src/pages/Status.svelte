<script lang="ts">
  import type { StatusResponse, PaginatedResult, SessionRow } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge } from '../lib/format.ts';
  import { onInvalidate } from '../lib/invalidate.ts';
  import DataTable from '../components/DataTable.svelte';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let sessions: SessionRow[] = $state([]);
  let sessionsLoading = $state(true);

  async function fetchSessions(signal: AbortSignal): Promise<void> {
    try {
      const data = await api<PaginatedResult<SessionRow>>('/api/sessions?perPage=5');
      if (signal.aborted) return;
      sessions = data.items;
    } catch {
    } finally {
      if (!signal.aborted) sessionsLoading = false;
    }
  }

  $effect(() => {
    const ac = new AbortController();
    fetchSessions(ac.signal);
    const unsub = onInvalidate((e) => {
      if (e.resource === 'sessions') fetchSessions(ac.signal);
    });
    return () => {
      ac.abort();
      unsub();
    };
  });
</script>

{#if !status}
  <div class="loading">Loading...</div>
{:else}
  <div class="stats">
    <div class="stat">
      <span class="stat-label">Processes</span>
      <span class="stat-value"
        >{status.processes.active}<span class="stat-dim">/{status.processes.maxConcurrent}</span
        ></span
      >
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-label">Flights</span>
      <span class="stat-value"
        >{status.jobs.pending + status.jobs.running}<span class="stat-dim">&nbsp;active</span></span
      >
      <span class="stat-sub">{status.jobs.completed} done / {status.jobs.failed} failed</span>
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-label">Messages</span>
      <span class="stat-value">{status.messages.totalMessages}</span>
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-label">Tokens</span>
      <span class="stat-value"
        >{(status.messages.totalTokensIn + status.messages.totalTokensOut).toLocaleString()}</span
      >
      <span class="stat-sub"
        >{status.messages.totalTokensIn.toLocaleString()} in / {status.messages.totalTokensOut.toLocaleString()}
        out</span
      >
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <h2 class="section-title">Recent Sessions</h2>
      <a href="#/sessions" class="section-link">View all</a>
    </div>
    <DataTable
      columns={['ID', 'Channel', 'Agent', 'Messages', 'Last Active']}
      isEmpty={sessions.length === 0}
      emptyMessage="No active sessions"
    >
      {#each sessions.slice(0, 5) as s (s.id)}
        <tr
          class="clickable-row"
          onclick={() => {
            window.location.hash = `#/session-detail?id=${s.id}`;
          }}
        >
          <td class="mono">{s.id}</td>
          <td class="mono">{s.channel_id}</td>
          <td>{s.agent_id}</td>
          <td>{s.message_count}</td>
          <td>{formatAge(s.last_active)}</td>
        </tr>
      {/each}
    </DataTable>
  </div>
{/if}

<style>
  .stats {
    display: flex;
    align-items: stretch;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .stat {
    flex: 1;
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .stat-sep {
    width: 1px;
    background: var(--color-border);
    flex-shrink: 0;
  }

  .stat-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--color-text-primary);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stat-dim {
    color: var(--color-text-muted);
    font-weight: 400;
  }

  .stat-sub {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .section {
    margin-top: var(--space-5);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }

  .section-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .section-link {
    font-size: var(--text-xs);
    color: var(--color-accent);
    text-decoration: none;
    font-family: var(--font-mono);
  }

  .section-link:hover {
    color: var(--color-accent-glow);
  }

  .clickable-row {
    cursor: pointer;
  }

  @media (max-width: 768px) {
    .stats {
      flex-direction: column;
    }

    .stat-sep {
      width: auto;
      height: 1px;
    }
  }
</style>

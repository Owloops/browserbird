<script lang="ts">
  import type { StatusResponse, PaginatedResult, SessionRow, LogRow } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let initialStatus: StatusResponse | null = $state(null);
  let sessions: SessionRow[] = $state([]);
  let logs: LogRow[] = $state([]);
  let loading = $state(true);

  const data = $derived(status ?? initialStatus);

  $effect(() => {
    const ac = new AbortController();
    Promise.all([
      api<StatusResponse>('/api/status'),
      api<PaginatedResult<SessionRow>>('/api/sessions?perPage=5'),
      api<PaginatedResult<LogRow>>('/api/logs?perPage=5'),
    ])
      .then(([s, sess, l]) => {
        if (ac.signal.aborted) return;
        initialStatus = s;
        sessions = sess.items;
        logs = l.items;
      })
      .finally(() => {
        if (!ac.signal.aborted) loading = false;
      });
    return () => ac.abort();
  });
</script>

{#if loading && !data}
  <div class="loading">Loading...</div>
{:else if data}
  <div class="stats">
    <div class="stat">
      <span class="stat-label">Sessions</span>
      <span class="stat-value"
        >{data.sessions.active}<span class="stat-dim">/{data.sessions.maxConcurrent}</span></span
      >
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-label">Jobs</span>
      <span class="stat-value">{data.jobs.pending + data.jobs.running}<span class="stat-dim">&nbsp;active</span></span>
      <span class="stat-sub">{data.jobs.completed} done / {data.jobs.failed} failed</span>
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-label">Messages</span>
      <span class="stat-value">{data.messages.totalMessages}</span>
    </div>
    <div class="stat-sep"></div>
    <div class="stat">
      <span class="stat-label">Tokens</span>
      <span class="stat-value"
        >{(data.messages.totalTokensIn + data.messages.totalTokensOut).toLocaleString()}</span
      >
      <span class="stat-sub"
        >{data.messages.totalTokensIn.toLocaleString()} in / {data.messages.totalTokensOut.toLocaleString()}
        out</span
      >
    </div>
  </div>

  <div class="sections">
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
            onclick={() => { window.location.hash = `#/session-detail?id=${s.id}`; }}
          >
            <td class="mono">{s.id}</td>
            <td class="mono">{s.slack_channel_id}</td>
            <td>{s.agent_id}</td>
            <td>{s.message_count}</td>
            <td>{formatAge(s.last_active)}</td>
          </tr>
        {/each}
      </DataTable>
    </div>

    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Recent Logs</h2>
        <a href="#/logs" class="section-link">View all</a>
      </div>
      <DataTable
        columns={['Level', 'Source', 'Message', 'Time']}
        isEmpty={logs.length === 0}
        emptyMessage="No logs recorded"
      >
        {#each logs as log (log.id)}
          <tr>
            <td><Badge status={log.level} /></td>
            <td class="mono">{log.source}</td>
            <td class="log-message">{log.message}</td>
            <td>{formatAge(log.created_at)}</td>
          </tr>
        {/each}
      </DataTable>
    </div>
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
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .stat-sep {
    width: 1px;
    background: var(--color-border);
    flex-shrink: 0;
  }

  .stat-label {
    font-size: 0.733rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: 1.2rem;
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
    font-size: 0.733rem;
    color: var(--color-text-muted);
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-top: 1.25rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .section-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .section-link {
    font-size: 0.733rem;
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

  .log-message {
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

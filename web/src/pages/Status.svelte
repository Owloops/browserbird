<script lang="ts">
  import type {
    StatusResponse,
    ColumnDef,
    PaginatedResult,
    SessionRow,
    FlightRow,
  } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge, flightDuration, shortUid } from '../lib/format.ts';
  import { onInvalidate } from '../lib/invalidate.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';

  const sessionColumns: ColumnDef[] = [
    { key: 'uid', label: 'ID' },
    { key: 'channel_id', label: 'Channel' },
    { key: 'agent_id', label: 'Agent' },
    { key: 'message_count', label: 'Messages' },
    { key: 'last_active', label: 'Last Active' },
  ];

  const flightColumns: ColumnDef[] = [
    { key: 'uid', label: 'ID' },
    { key: 'bird_name', label: 'Bird' },
    { key: 'status', label: 'Status' },
    { key: 'duration', label: 'Duration' },
    { key: 'started_at', label: 'Started' },
  ];

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let sessions: SessionRow[] = $state([]);
  let sessionsLoading = $state(true);
  let flights: FlightRow[] = $state([]);
  let flightsLoading = $state(true);

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

  async function fetchFlights(signal: AbortSignal): Promise<void> {
    try {
      const data = await api<PaginatedResult<FlightRow>>('/api/flights?perPage=5');
      if (signal.aborted) return;
      flights = data.items;
    } catch {
    } finally {
      if (!signal.aborted) flightsLoading = false;
    }
  }

  $effect(() => {
    const ac = new AbortController();
    fetchSessions(ac.signal);
    fetchFlights(ac.signal);
    const unsub = onInvalidate((e) => {
      if (e.resource === 'sessions') fetchSessions(ac.signal);
      if (e.resource === 'birds') fetchFlights(ac.signal);
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
        >{status.flights.running}<span class="stat-dim">&nbsp;active</span></span
      >
      <span class="stat-sub">{status.flights.completed} done / {status.flights.failed} failed</span>
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
      columns={sessionColumns}
      isEmpty={sessions.length === 0}
      emptyMessage="No active sessions"
    >
      {#each sessions.slice(0, 5) as s (s.uid)}
        <tr
          class="clickable-row"
          onclick={() => {
            window.location.hash = `#/session-detail?id=${s.uid}`;
          }}
        >
          <td class="mono">{shortUid(s.uid)}</td>
          <td class="mono">{s.channel_id}</td>
          <td>{s.agent_id}</td>
          <td>{s.message_count}</td>
          <td>{formatAge(s.last_active)}</td>
        </tr>
      {/each}
    </DataTable>
  </div>

  <div class="section">
    <div class="section-header">
      <h2 class="section-title">Recent Flights</h2>
      <a href="#/flights" class="section-link">View all</a>
    </div>
    <DataTable
      columns={flightColumns}
      isEmpty={flights.length === 0}
      emptyMessage="No flights recorded"
    >
      {#each flights.slice(0, 5) as f (f.uid)}
        <tr
          class="clickable-row"
          onclick={() => {
            window.location.hash = `#/flights?birdUid=${f.bird_uid}`;
          }}
        >
          <td class="mono">{shortUid(f.uid)}</td>
          <td>{f.bird_name}</td>
          <td><Badge status={f.status} /></td>
          <td class="mono">{flightDuration(f.started_at, f.finished_at)}</td>
          <td>{formatAge(f.started_at)}</td>
        </tr>
      {/each}
    </DataTable>
  </div>
{/if}

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
  }

  .stat {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .stat-sep {
    display: none;
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
    margin-top: var(--space-6);
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
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .stats {
      grid-template-columns: 1fr;
      gap: var(--space-2);
    }

    .stat {
      padding: var(--space-3) var(--space-4);
    }

    .stat-value {
      font-size: var(--text-lg);
    }
  }
</style>

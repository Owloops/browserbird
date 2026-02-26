<script lang="ts">
  import type {
    StatusResponse,
    PaginatedResult,
    CronJobRow,
    FlightRow,
    SessionRow,
    UpcomingBird,
  } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import {
    formatAge,
    flightDuration,
    formatCountdown,
    shortUid,
    timeStamp,
  } from '../lib/format.ts';
  import { onInvalidate } from '../lib/invalidate.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let failingBirds: CronJobRow[] = $state([]);
  let upcomingBirds: UpcomingBird[] = $state([]);
  let runningFlights: FlightRow[] = $state([]);
  let recentFlights: FlightRow[] = $state([]);
  let recentSessions: SessionRow[] = $state([]);
  let lastUpdated = $state(timeStamp());
  let loading = $state(true);

  const failingColumns = [
    { key: 'uid', label: 'ID' },
    { key: 'name', label: 'Bird' },
    { key: 'failure_count', label: 'Failures' },
    { key: 'last_status', label: 'Status' },
    { key: 'last_run', label: 'Last Run' },
    { key: 'actions', label: '' },
  ];

  const upcomingColumns = [
    { key: 'uid', label: 'ID' },
    { key: 'name', label: 'Bird' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'next_run', label: 'Next Run' },
  ];

  const flightColumns = [
    { key: 'uid', label: 'ID' },
    { key: 'bird_name', label: 'Bird' },
    { key: 'status', label: 'Status' },
    { key: 'duration', label: 'Duration' },
    { key: 'started_at', label: 'Started' },
  ];

  const sessionColumns = [
    { key: 'uid', label: 'ID' },
    { key: 'channel_id', label: 'Channel' },
    { key: 'agent_id', label: 'Agent' },
    { key: 'message_count', label: 'Messages' },
    { key: 'last_active', label: 'Last Active' },
  ];

  async function fetchAll(signal: AbortSignal): Promise<void> {
    try {
      const [birdsRes, upcomingRes, runningRes, flightsRes, sessionsRes] = await Promise.all([
        api<PaginatedResult<CronJobRow>>('/api/birds?perPage=100'),
        api<UpcomingBird[]>('/api/birds/upcoming?limit=5'),
        api<PaginatedResult<FlightRow>>('/api/flights?status=running&perPage=5'),
        api<PaginatedResult<FlightRow>>('/api/flights?perPage=5'),
        api<PaginatedResult<SessionRow>>('/api/sessions?perPage=5'),
      ]);
      if (signal.aborted) return;
      failingBirds = birdsRes.items.filter((b) => b.failure_count > 0);
      failingBirds.sort((a, b) => b.failure_count - a.failure_count);
      upcomingBirds = upcomingRes;
      runningFlights = runningRes.items;
      recentFlights = flightsRes.items;
      recentSessions = sessionsRes.items;
      lastUpdated = timeStamp();
    } catch {
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  $effect(() => {
    const ac = new AbortController();
    fetchAll(ac.signal);
    const unsub = onInvalidate((e) => {
      if (e.resource === 'sessions' || e.resource === 'birds') fetchAll(ac.signal);
    });
    return () => {
      ac.abort();
      unsub();
    };
  });

  async function flyBird(uid: string): Promise<void> {
    try {
      await api(`/api/birds/${uid}/fly`, { method: 'POST' });
      showToast(`Bird ${shortUid(uid)} sent on a flight`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  const slackOk = $derived(status?.slack.connected ?? false);
  const agentOk = $derived(status?.agent.available ?? false);
  const browserEnabled = $derived(status?.browser.enabled ?? false);
  const browserOk = $derived(status?.browser.connected ?? false);
</script>

{#if !status}
  <div class="loading">Loading...</div>
{:else}
  <div class="health-bar">
    <div class="health-item">
      <span class="health-dot" class:dot-ok={agentOk} class:dot-err={!agentOk}></span>
      <span class="health-label">Agent CLI</span>
      <span class="health-detail mono">{agentOk ? 'ready' : 'unavailable'}</span>
    </div>
    <div class="health-item">
      <span class="health-dot" class:dot-ok={slackOk} class:dot-err={!slackOk}></span>
      <span class="health-label">Slack</span>
      <span class="health-detail mono">{slackOk ? 'connected' : 'disconnected'}</span>
    </div>
    {#if browserEnabled}
      <div class="health-item">
        <span class="health-dot" class:dot-ok={browserOk} class:dot-err={!browserOk}></span>
        <span class="health-label">Browser</span>
        <span class="health-detail mono">{browserOk ? 'connected' : 'unreachable'}</span>
      </div>
    {/if}
    <div class="health-spacer"></div>
    <div class="health-item">
      <span class="health-label">Processes</span>
      <span class="health-detail mono"
        >{status.processes.active}/{status.processes.maxConcurrent}</span
      >
    </div>
  </div>

  <div class="stat-strip">
    <div class="stat-item">
      <span class="stat-value">{status.flights.running}<span class="stat-dim"> active</span></span>
      <span class="stat-sub">{status.flights.completed} done · {status.flights.failed} failed</span>
    </div>
    <div class="stat-item">
      <span class="stat-value"
        >{status.messages.totalMessages}<span class="stat-dim"> msgs</span></span
      >
    </div>
    <div class="stat-item">
      <span class="stat-value"
        >{(status.messages.totalTokensIn + status.messages.totalTokensOut).toLocaleString()}<span
          class="stat-dim"
        >
          tokens</span
        ></span
      >
      <span class="stat-sub"
        >{status.messages.totalTokensIn.toLocaleString()} in / {status.messages.totalTokensOut.toLocaleString()}
        out</span
      >
    </div>
  </div>

  {#if failingBirds.length > 0}
    <div class="section">
      <div class="section-header">
        <h2 class="section-title section-title-error">Failing Birds</h2>
        <span class="last-updated">Updated {lastUpdated}</span>
      </div>
      <DataTable columns={failingColumns} isEmpty={false}>
        {#each failingBirds as bird (bird.uid)}
          <tr>
            <td class="mono">{shortUid(bird.uid)}</td>
            <td>
              <a class="bird-link" href="#/birds?search={encodeURIComponent(shortUid(bird.uid))}">
                {bird.name}
              </a>
            </td>
            <td class="mono failure-count">{bird.failure_count}</td>
            <td
              >{#if bird.last_status}<Badge status={bird.last_status} />{:else}-{/if}</td
            >
            <td>{bird.last_run ? formatAge(bird.last_run) : '-'}</td>
            <td>
              <button class="btn btn-outline btn-sm" onclick={() => flyBird(bird.uid)}>Retry</button
              >
            </td>
          </tr>
        {/each}
      </DataTable>
    </div>
  {/if}

  {#if runningFlights.length > 0}
    <div class="section">
      <div class="section-header">
        <h2 class="section-title section-title-active">Active Flights</h2>
      </div>
      <DataTable columns={flightColumns} isEmpty={false}>
        {#each runningFlights as f (f.uid)}
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

  {#if upcomingBirds.length > 0}
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Next Up</h2>
      </div>
      <DataTable columns={upcomingColumns} isEmpty={false}>
        {#each upcomingBirds as bird (bird.uid)}
          <tr
            class="clickable-row"
            onclick={() => {
              window.location.hash = `#/birds?search=${encodeURIComponent(shortUid(bird.uid))}`;
            }}
          >
            <td class="mono">{shortUid(bird.uid)}</td>
            <td>{bird.name}</td>
            <td class="mono">{bird.schedule}</td>
            <td class="mono countdown">{formatCountdown(bird.next_run)}</td>
          </tr>
        {/each}
      </DataTable>
    </div>
  {/if}

  <div class="section">
    <div class="section-header">
      <h2 class="section-title">Recent Flights</h2>
      <a href="#/flights" class="section-link">View all</a>
    </div>
    <DataTable
      columns={flightColumns}
      isEmpty={recentFlights.length === 0}
      emptyMessage="No flights recorded"
    >
      {#each recentFlights as f (f.uid)}
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

  <div class="section">
    <div class="section-header">
      <h2 class="section-title">Recent Sessions</h2>
      <a href="#/sessions" class="section-link">View all</a>
    </div>
    <DataTable
      columns={sessionColumns}
      isEmpty={recentSessions.length === 0}
      emptyMessage="No active sessions"
    >
      {#each recentSessions as s (s.uid)}
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
{/if}

<style>
  .health-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
  }

  .health-item {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
  }

  .health-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-ok {
    background: var(--color-success);
    box-shadow: 0 0 4px var(--color-success);
  }

  .dot-err {
    background: var(--color-error);
    box-shadow: 0 0 4px var(--color-error);
  }

  .health-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .health-detail {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .health-spacer {
    flex: 1;
  }

  .stat-strip {
    display: flex;
    gap: var(--space-6);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
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

  .section-title-error {
    color: var(--color-error);
  }

  .section-title-active {
    color: var(--color-success);
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

  .last-updated {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .clickable-row {
    cursor: pointer;
  }

  .bird-link {
    color: var(--color-accent);
    text-decoration: none;
    font-size: var(--text-sm);
  }

  .bird-link:hover {
    color: var(--color-accent-glow);
  }

  .failure-count {
    color: var(--color-error);
    font-weight: 600;
  }

  .countdown {
    color: var(--color-accent-glow);
  }

  @media (max-width: 768px) {
    .health-bar {
      gap: var(--space-2-5);
      padding: var(--space-2-5) var(--space-3);
    }

    .stat-strip {
      flex-wrap: wrap;
      gap: var(--space-4);
      padding: var(--space-2-5) var(--space-3);
    }

    .health-spacer {
      display: none;
    }
  }

  @media (max-width: 480px) {
    .stat-strip {
      flex-direction: column;
      gap: var(--space-2);
    }
  }
</style>

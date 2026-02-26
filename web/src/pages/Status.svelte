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
  <div class="svc-row">
    <div class="svc-card" class:svc-ok={agentOk} class:svc-err={!agentOk}>
      <span class="svc-dot" class:dot-ok={agentOk} class:dot-err={!agentOk}></span>
      <span class="svc-label">Agent CLI</span>
      <span class="svc-detail mono">{agentOk ? 'ready' : 'unavailable'}</span>
    </div>
    <div class="svc-card" class:svc-ok={slackOk} class:svc-err={!slackOk}>
      <span class="svc-dot" class:dot-ok={slackOk} class:dot-err={!slackOk}></span>
      <span class="svc-label">Slack</span>
      <span class="svc-detail mono">{slackOk ? 'connected' : 'disconnected'}</span>
    </div>
    {#if browserEnabled}
      <div class="svc-card" class:svc-ok={browserOk} class:svc-err={!browserOk}>
        <span class="svc-dot" class:dot-ok={browserOk} class:dot-err={!browserOk}></span>
        <span class="svc-label">Browser</span>
        <span class="svc-detail mono">{browserOk ? 'connected' : 'unreachable'}</span>
      </div>
    {/if}
  </div>

  <div class="num-grid">
    <div class="num-card num-card-accent">
      <div class="num-head">
        <span class="num-label">Flights</span>
        <span class="num-badge mono"
          >{status.processes.active}/{status.processes.maxConcurrent} processes</span
        >
      </div>
      <div class="num-value">{status.flights.running}</div>
      <div class="num-sub">
        <span>{status.flights.completed} done</span>
        <span class="num-sep"></span>
        <span>{status.flights.failed} failed</span>
      </div>
    </div>
    <div class="num-card num-card-neutral">
      <div class="num-head">
        <span class="num-label">Messages</span>
      </div>
      <div class="num-value">{status.messages.totalMessages}</div>
      <div class="num-sub">
        <span>{status.sessions.total} {status.sessions.total === 1 ? 'session' : 'sessions'}</span>
      </div>
    </div>
    <div class="num-card num-card-warm">
      <div class="num-head">
        <span class="num-label">Tokens</span>
      </div>
      <div class="num-value">
        {(status.messages.totalTokensIn + status.messages.totalTokensOut).toLocaleString()}
      </div>
      <div class="num-sub">
        <span>{status.messages.totalTokensIn.toLocaleString()} in</span>
        <span class="num-sep"></span>
        <span>{status.messages.totalTokensOut.toLocaleString()} out</span>
      </div>
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
              window.location.hash = `#/birds?expand=${f.bird_uid}`;
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
      <a href="#/birds" class="section-link">View all</a>
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
            window.location.hash = `#/birds?expand=${f.bird_uid}`;
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
  /* Service health row */
  .svc-row {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .svc-card {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    transition: all var(--transition-normal);
  }

  .svc-ok {
    border-color: rgba(62, 201, 122, 0.2);
    background: rgba(62, 201, 122, 0.04);
  }

  .svc-err {
    border-color: rgba(224, 92, 92, 0.2);
    background: rgba(224, 92, 92, 0.04);
  }

  .svc-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-ok {
    background: var(--color-success);
    box-shadow: 0 0 6px rgba(62, 201, 122, 0.5);
  }

  .dot-err {
    background: var(--color-error);
    box-shadow: 0 0 6px rgba(224, 92, 92, 0.5);
  }

  .svc-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .svc-detail {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* Stat cards grid */
  .num-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .num-card {
    position: relative;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-4) var(--space-3);
    overflow: hidden;
    transition:
      border-color var(--transition-normal),
      box-shadow var(--transition-normal);
  }

  .num-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }

  .num-card::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 120px;
    height: 120px;
    border-radius: 50%;
    filter: blur(50px);
    opacity: 0;
    transition: opacity var(--transition-normal);
    pointer-events: none;
  }

  .num-card:hover {
    border-color: var(--color-border-subtle);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  }

  .num-card:hover::after {
    opacity: 1;
  }

  .num-card-accent::before {
    background: linear-gradient(90deg, var(--color-accent), transparent);
  }

  .num-card-accent::after {
    background: rgba(91, 140, 240, 0.06);
  }

  .num-card-neutral::before {
    background: linear-gradient(90deg, var(--color-text-muted), transparent);
  }

  .num-card-neutral::after {
    background: rgba(136, 145, 160, 0.04);
  }

  .num-card-warm::before {
    background: linear-gradient(90deg, var(--color-warning), transparent);
  }

  .num-card-warm::after {
    background: rgba(232, 168, 62, 0.06);
  }

  .num-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }

  .num-label {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .num-badge {
    font-size: var(--text-xs);
    color: var(--color-accent);
    background: var(--color-accent-bg);
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
  }

  .num-value {
    font-family: var(--font-mono);
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--color-text-primary);
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin-bottom: var(--space-1);
  }

  .num-sub {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .num-sep {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--color-border-subtle);
    flex-shrink: 0;
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
    .svc-row {
      flex-wrap: wrap;
    }

    .num-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 480px) {
    .num-grid {
      grid-template-columns: 1fr;
    }

    .num-card {
      padding: var(--space-3);
    }

    .num-value {
      font-size: var(--text-xl);
    }
  }
</style>

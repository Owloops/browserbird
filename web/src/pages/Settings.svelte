<script lang="ts">
  import type {
    StatusResponse,
    ConfigResponse,
    DoctorResponse,
    PaginatedResult,
    LogRow,
    JobStats,
    CronJobRow,
    FlightRow,
  } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge, formatUptime, flightDuration, shortUid } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import Badge from '../components/Badge.svelte';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let config: ConfigResponse | null = $state(null);
  let doctor: DoctorResponse | null = $state(null);
  let doctorLoading = $state(true);
  let recentErrors: LogRow[] = $state([]);
  let jobStats: JobStats | null = $state(null);
  let systemBirds: CronJobRow[] = $state([]);
  let systemFlights: Record<string, FlightRow[]> = $state({});
  let loading = $state(true);
  let activeTab: 'config' | 'database' = $state('config');

  $effect(() => {
    const ac = new AbortController();
    Promise.all([
      api<ConfigResponse>('/api/config'),
      api<PaginatedResult<LogRow>>('/api/logs?level=error&perPage=10'),
      api<JobStats>('/api/jobs/stats'),
      api<PaginatedResult<CronJobRow>>('/api/birds?system=true&perPage=100'),
    ])
      .then(([c, logs, js, birds]) => {
        if (ac.signal.aborted) return;
        config = c;
        recentErrors = logs.items;
        jobStats = js;
        systemBirds = birds.items.filter((b) => b.name.startsWith('__bb_'));
      })
      .finally(() => {
        if (!ac.signal.aborted) loading = false;
      });
    return () => ac.abort();
  });

  $effect(() => {
    const ac = new AbortController();
    api<DoctorResponse>('/api/doctor')
      .then((d) => {
        if (!ac.signal.aborted) doctor = d;
      })
      .finally(() => {
        if (!ac.signal.aborted) doctorLoading = false;
      });
    return () => ac.abort();
  });

  const configuredProviders = $derived.by(() => {
    const providers = config?.agents.map((a) => a.provider);
    return new Set(providers ?? []);
  });

  async function loadSystemFlights(birdUid: string): Promise<void> {
    if (systemFlights[birdUid]) return;
    try {
      const result = await api<PaginatedResult<FlightRow>>(
        `/api/birds/${birdUid}/flights?perPage=5`,
      );
      systemFlights = { ...systemFlights, [birdUid]: result.items };
    } catch {
      systemFlights = { ...systemFlights, [birdUid]: [] };
    }
  }

  let retryingFailed = $state(false);
  let clearingCompleted = $state(false);
  let clearingFailed = $state(false);

  async function retryAllFailed(): Promise<void> {
    retryingFailed = true;
    try {
      const result = await api<{ count: number }>('/api/jobs/retry-all', { method: 'POST' });
      showToast(`${result.count} failed job(s) queued for retry`, 'success');
      jobStats = await api<JobStats>('/api/jobs/stats');
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
      jobStats = await api<JobStats>('/api/jobs/stats');
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
      jobStats = await api<JobStats>('/api/jobs/stats');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      clearingFailed = false;
    }
  }

  async function flySystemBird(uid: string, name: string): Promise<void> {
    try {
      const result = await api<{ success: boolean; jobId: number }>(`/api/birds/${uid}/fly`, {
        method: 'POST',
      });
      showToast(`${name} sent on a flight (job #${result.jobId})`, 'success');
      const { [uid]: _, ...rest } = systemFlights;
      systemFlights = rest;
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else if config}
  <div class="tabs">
    <button
      class="tab"
      class:tab-active={activeTab === 'config'}
      onclick={() => {
        activeTab = 'config';
      }}>Config</button
    >
    <button
      class="tab"
      class:tab-active={activeTab === 'database'}
      onclick={() => {
        activeTab = 'database';
      }}>Database</button
    >
  </div>

  {#if activeTab === 'config'}
    <div class="group">
      <h2 class="group-title">System</h2>
      <div class="fields">
        {#if status}
          <div class="field">
            <span class="field-label">Uptime</span>
            <span class="field-value mono">{formatUptime(status.uptime)}</span>
          </div>
        {/if}
        <div class="field">
          <span class="field-label">Timezone</span>
          <span class="field-value mono">{config.timezone}</span>
        </div>
        <div class="field">
          <span class="field-label">Web Port</span>
          <span class="field-value mono">{config.web.port}</span>
        </div>
        <div class="field">
          <span class="field-label">Agent CLI</span>
          <span class="field-value">
            {#if doctorLoading}
              {@const claude = configuredProviders.has('claude')}
              {@const opencode = configuredProviders.has('opencode')}
              {#if claude}
                <span class="cli-pill"><span class="dot dot-muted"></span> claude ...</span>
              {/if}
              {#if opencode}
                <span class="cli-pill"><span class="dot dot-muted"></span> opencode ...</span>
              {/if}
              {#if !claude && !opencode}
                <span class="field-dim">Checking...</span>
              {/if}
            {:else if doctor}
              {#each [{ key: 'claude', info: doctor.claude }, { key: 'opencode', info: doctor.opencode }] as { key, info }}
                {@const configured = configuredProviders.has(key)}
                {#if configured && info.available}
                  <span class="cli-pill cli-pill-ok"
                    ><span class="dot dot-on"></span> {key} {info.version}</span
                  >
                {:else if configured && !info.available}
                  <span class="cli-pill cli-pill-err"
                    ><span class="dot dot-off"></span> {key} not found</span
                  >
                {:else if !configured && info.available}
                  <span class="cli-pill"
                    ><span class="dot dot-muted"></span> {key} {info.version}</span
                  >
                {/if}
              {/each}
            {/if}
          </span>
        </div>
        {#if doctor}
          <div class="field">
            <span class="field-label">Node.js</span>
            <span class="field-value mono">{doctor.node}</span>
          </div>
        {/if}
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Agents</h2>
      {#each config.agents as agent (agent.id)}
        <div class="agent-card">
          <div class="agent-header">
            <span class="agent-name">{agent.name}</span>
            <span class="agent-id mono">{agent.id}</span>
          </div>
          <div class="fields">
            <div class="field">
              <span class="field-label">Provider</span>
              <span class="field-value mono">{agent.provider}</span>
            </div>
            <div class="field">
              <span class="field-label">Model</span>
              <span class="field-value mono">{agent.model}</span>
            </div>
            <div class="field">
              <span class="field-label">Max Turns</span>
              <span class="field-value mono">{agent.maxTurns}</span>
            </div>
            <div class="field">
              <span class="field-label">Channels</span>
              <span class="field-value mono">{agent.channels.join(', ') || '*'}</span>
            </div>
          </div>
        </div>
      {/each}
    </div>

    <div class="group">
      <h2 class="group-title">Sessions</h2>
      <div class="fields">
        <div class="field">
          <span class="field-label">Max Concurrent</span>
          <span class="field-value mono">{config.sessions.maxConcurrent}</span>
        </div>
        <div class="field">
          <span class="field-label">TTL</span>
          <span class="field-value mono">{config.sessions.ttlHours}h</span>
        </div>
        <div class="field">
          <span class="field-label">Timeout</span>
          <span class="field-value mono"
            >{(config.sessions.processTimeoutMs / 1000).toFixed(0)}s</span
          >
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Slack</h2>
      <div class="fields">
        {#if status}
          <div class="field">
            <span class="field-label">Connected</span>
            <span class="field-value">
              <span
                class="dot"
                class:dot-on={status.slack.connected}
                class:dot-off={!status.slack.connected}
              ></span>
              {status.slack.connected ? 'Yes' : 'No'}
            </span>
          </div>
        {/if}
        <div class="field">
          <span class="field-label">Require Mention</span>
          <span class="field-value">{config.slack.requireMention ? 'Yes' : 'No'}</span>
        </div>
        <div class="field">
          <span class="field-label">Debounce</span>
          <span class="field-value mono">{config.slack.coalesce.debounceMs}ms</span>
        </div>
        <div class="field">
          <span class="field-label">Bypass DMs</span>
          <span class="field-value">{config.slack.coalesce.bypassDms ? 'Yes' : 'No'}</span>
        </div>
        <div class="field">
          <span class="field-label">Channels</span>
          <span class="field-value mono">{config.slack.channels.join(', ') || '*'}</span>
        </div>
        <div class="field">
          <span class="field-label">Quiet Hours</span>
          <span class="field-value">
            {#if config.slack.quietHours.enabled}
              <span class="mono">{config.slack.quietHours.start}-{config.slack.quietHours.end}</span
              >
              ({config.slack.quietHours.timezone})
            {:else}
              Disabled
            {/if}
          </span>
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Birds</h2>
      <div class="fields">
        <div class="field">
          <span class="field-label">Max Attempts</span>
          <span class="field-value mono">{config.birds.maxAttempts}</span>
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Browser</h2>
      <div class="fields">
        <div class="field">
          <span class="field-label">Enabled</span>
          <span class="field-value">{config.browser.enabled ? 'Yes' : 'No'}</span>
        </div>
        {#if config.browser.enabled && status}
          <div class="field">
            <span class="field-label">Connected</span>
            <span class="field-value">
              <span
                class="dot"
                class:dot-on={status.browser.connected}
                class:dot-off={!status.browser.connected}
              ></span>
              {status.browser.connected ? 'Yes' : 'No'}
            </span>
          </div>
        {/if}
        {#if config.browser.enabled}
          <div class="field">
            <span class="field-label">VNC Port</span>
            <span class="field-value mono">{config.browser.vncPort}</span>
          </div>
          <div class="field">
            <span class="field-label">noVNC Port</span>
            <span class="field-value mono">{config.browser.novncPort}</span>
          </div>
        {/if}
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">Database</h2>
      <div class="fields">
        <div class="field">
          <span class="field-label">Retention</span>
          <span class="field-value mono">{config.database.retentionDays}d</span>
        </div>
      </div>
    </div>
  {/if}

  {#if activeTab === 'database'}
    <div class="group">
      <h2 class="group-title">Job Queue</h2>
      <div class="fields">
        {#if jobStats}
          <div class="field">
            <span class="field-label">Queue</span>
            <span class="field-value mono"
              >{jobStats.pending} pending {jobStats.running} running {jobStats.completed} done {jobStats.failed}
              failed</span
            >
          </div>
        {/if}
        <div class="field">
          <span class="field-label">Retry Failed</span>
          <span class="field-value">
            <span class="field-dim">Reset all failed jobs to pending</span>
            <button
              class="btn btn-outline btn-sm"
              disabled={retryingFailed || (jobStats?.failed ?? 0) === 0}
              onclick={retryAllFailed}>{retryingFailed ? 'Retrying...' : 'Retry All Failed'}</button
            >
          </span>
        </div>
        <div class="field">
          <span class="field-label">Clear Completed</span>
          <span class="field-value">
            <span class="field-dim">Delete completed job records</span>
            <button
              class="btn btn-outline btn-sm"
              disabled={clearingCompleted || (jobStats?.completed ?? 0) === 0}
              onclick={clearCompleted}
              >{clearingCompleted ? 'Clearing...' : 'Clear Completed'}</button
            >
          </span>
        </div>
        <div class="field">
          <span class="field-label">Clear Failed</span>
          <span class="field-value">
            <span class="field-dim">Delete failed job records</span>
            <button
              class="btn btn-outline btn-sm"
              disabled={clearingFailed || (jobStats?.failed ?? 0) === 0}
              onclick={clearFailed}>{clearingFailed ? 'Clearing...' : 'Clear Failed'}</button
            >
          </span>
        </div>
      </div>
    </div>

    <div class="group">
      <h2 class="group-title">System Birds</h2>
      {#if systemBirds.length === 0}
        <div class="fields">
          <div class="field">
            <span class="field-dim">No system birds registered</span>
          </div>
        </div>
      {:else}
        {#each systemBirds as bird (bird.uid)}
          <div class="system-bird-card">
            <div class="system-bird-header">
              <span class="system-bird-name">{bird.name}</span>
              <div class="system-bird-actions">
                <span class="mono system-bird-schedule">{bird.schedule}</span>
                <button
                  class="btn btn-outline btn-sm"
                  onclick={() => flySystemBird(bird.uid, bird.name)}>Fly</button
                >
              </div>
            </div>
            <div class="fields">
              <div class="field">
                <span class="field-label">Last Run</span>
                <span class="field-value">
                  {#if bird.last_run}
                    {formatAge(bird.last_run)}
                    {#if bird.last_status}
                      <Badge status={bird.last_status} />
                    {/if}
                  {:else}
                    <span class="field-dim">Never</span>
                  {/if}
                </span>
              </div>
              <div class="field">
                <span class="field-label">Recent Flights</span>
                <span class="field-value">
                  {#if !systemFlights[bird.uid]}
                    <button
                      class="btn btn-outline btn-sm"
                      onclick={() => loadSystemFlights(bird.uid)}>Load</button
                    >
                  {:else if systemFlights[bird.uid]!.length === 0}
                    <span class="field-dim">No flights</span>
                  {:else}
                    <span class="field-dim">{systemFlights[bird.uid]!.length} flight(s)</span>
                  {/if}
                </span>
              </div>
            </div>
            {#if systemFlights[bird.uid]?.length}
              <div class="system-flights">
                {#each systemFlights[bird.uid] as flight (flight.uid)}
                  <div class="system-flight-row">
                    <span class="mono system-flight-id">{shortUid(flight.uid)}</span>
                    <Badge status={flight.status} />
                    <span class="mono">{flightDuration(flight.started_at, flight.finished_at)}</span
                    >
                    <span class="system-flight-time">{formatAge(flight.started_at)}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <div class="group">
      <h2 class="group-title">Logs</h2>
      {#if recentErrors.length === 0}
        <div class="fields">
          <div class="field">
            <span class="field-dim">No logs recorded</span>
          </div>
        </div>
      {:else}
        <div class="error-list">
          {#each recentErrors as error (error.id)}
            <div class="error-row">
              <span class="error-source mono">{error.source}</span>
              <span class="error-message">{error.message}</span>
              <span class="error-time">{formatAge(error.created_at)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .tabs {
    display: flex;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 0;
  }

  .tab {
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .tab:hover {
    color: var(--color-text-secondary);
  }

  .tab-active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-accent);
  }

  .group {
    margin-bottom: var(--space-5);
  }

  .group-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: var(--space-2);
  }

  .fields {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2-5) var(--space-4);
    border-bottom: 1px solid rgba(35, 42, 53, 0.6);
  }

  .field:last-child {
    border-bottom: none;
  }

  .field-label {
    font-size: var(--text-base);
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .field-value {
    font-size: var(--text-base);
    color: var(--color-text-primary);
    text-align: right;
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
  }

  .field-dim {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .agent-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: var(--space-2);
  }

  .agent-card .fields {
    border: none;
    border-top: 1px solid var(--color-border);
    border-radius: 0;
  }

  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
  }

  .agent-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .agent-id {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .error-list {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .error-row {
    display: grid;
    grid-template-columns: 6rem 1fr auto;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }

  .error-row:last-child {
    border-bottom: none;
  }

  .error-source {
    color: var(--color-error);
    font-size: var(--text-xs);
    flex-shrink: 0;
  }

  .error-message {
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-time {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .dot {
    width: var(--dot-size);
    height: var(--dot-size);
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-on {
    background: var(--color-success);
    box-shadow: 0 0 4px var(--color-success);
  }

  .dot-off {
    background: var(--color-error);
    box-shadow: 0 0 4px var(--color-error);
  }

  .dot-muted {
    background: var(--color-text-muted);
  }

  .cli-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    color: var(--color-text-muted);
  }

  .cli-pill-ok {
    border-color: rgba(62, 201, 122, 0.3);
    background: var(--color-success-bg);
    color: var(--color-success);
  }

  .cli-pill-err {
    border-color: rgba(224, 92, 92, 0.3);
    background: var(--color-error-bg);
    color: var(--color-error);
  }

  .system-bird-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: var(--space-2);
  }

  .system-bird-card .fields {
    border: none;
    border-top: 1px solid var(--color-border);
    border-radius: 0;
  }

  .system-bird-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
  }

  .system-bird-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
  }

  .system-bird-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .system-bird-schedule {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .system-flights {
    border-top: 1px solid var(--color-border);
  }

  .system-flight-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    font-size: var(--text-sm);
  }

  .system-flight-row:last-child {
    border-bottom: none;
  }

  .system-flight-id {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    min-width: 3rem;
  }

  .system-flight-time {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    margin-left: auto;
  }

  @media (max-width: 768px) {
    .field {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-1);
    }

    .field-value {
      text-align: left;
      flex-wrap: wrap;
    }

    .error-row {
      grid-template-columns: 1fr;
      gap: var(--space-1);
    }

    .error-source {
      font-size: var(--text-xs);
    }

    .error-message {
      white-space: normal;
    }

    .system-bird-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-1-5);
    }

    .system-flight-row {
      flex-wrap: wrap;
    }
  }

  @media (max-width: 480px) {
    .tabs {
      flex-wrap: wrap;
      gap: 0;
    }

    .tab {
      font-size: var(--text-sm);
      padding: var(--space-1-5) var(--space-2);
    }
  }
</style>

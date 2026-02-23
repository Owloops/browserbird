<script lang="ts">
  import type {
    StatusResponse,
    ConfigResponse,
    CleanupResponse,
    DoctorResponse,
    PaginatedResult,
    LogRow,
    JobStats,
  } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge, formatUptime } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { showConfirm } from '../lib/confirm.svelte.ts';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let config: ConfigResponse | null = $state(null);
  let doctor: DoctorResponse | null = $state(null);
  let recentErrors: LogRow[] = $state([]);
  let jobStats: JobStats | null = $state(null);
  let loading = $state(true);
  let activeTab: 'config' | 'database' = $state('config');

  $effect(() => {
    const ac = new AbortController();
    Promise.all([
      api<ConfigResponse>('/api/config'),
      api<DoctorResponse>('/api/doctor'),
      api<PaginatedResult<LogRow>>('/api/logs?level=error&perPage=10'),
      api<JobStats>('/api/jobs/stats'),
    ])
      .then(([c, d, logs, js]) => {
        if (ac.signal.aborted) return;
        config = c;
        doctor = d;
        recentErrors = logs.items;
        jobStats = js;
      })
      .finally(() => {
        if (!ac.signal.aborted) loading = false;
      });
    return () => ac.abort();
  });

  let cleaningUp = $state(false);
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

  async function runCleanup(): Promise<void> {
    if (
      !(await showConfirm(
        `Delete all records older than ${config?.database.retentionDays ?? 30}d?`,
      ))
    )
      return;
    cleaningUp = true;
    try {
      const result = await api<CleanupResponse>('/api/db/cleanup', {
        method: 'POST',
        body: {},
      });
      const total = result.messages + result.cronRuns + result.jobs + result.logs;
      showToast(
        `Cleanup done: ${total} record(s) removed (${result.messages} messages, ${result.cronRuns} flight logs, ${result.jobs} jobs, ${result.logs} logs)`,
        'success',
      );
    } catch (err) {
      showToast(`Cleanup failed: ${(err as Error).message}`, 'error');
    } finally {
      cleaningUp = false;
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
          <span class="field-label">Web Port</span>
          <span class="field-value mono">{config.web.port}</span>
        </div>
        <div class="field">
          <span class="field-label">Auth</span>
          <span class="field-value">{config.web.authEnabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        {#if doctor}
          <div class="field">
            <span class="field-label">Claude CLI</span>
            <span class="field-value">
              {#if doctor.claude.available}
                <span class="dot dot-on"></span>
                <span class="mono">{doctor.claude.version}</span>
              {:else}
                <span class="dot dot-off"></span>
                Not found
              {/if}
            </span>
          </div>
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
        <div class="field">
          <span class="field-label">Long Response</span>
          <span class="field-value mono">{config.sessions.longResponseMode}</span>
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
          <span class="field-label">Allow Channels</span>
          <span class="field-value mono"
            >{config.slack.permissions.allowChannels.join(', ') || '*'}</span
          >
        </div>
        {#if config.slack.permissions.denyChannels.length > 0}
          <div class="field">
            <span class="field-label">Deny Channels</span>
            <span class="field-value mono">{config.slack.permissions.denyChannels.join(', ')}</span>
          </div>
        {/if}
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
        {#if config.browser.enabled}
          <div class="field">
            <span class="field-label">Resolution</span>
            <span class="field-value mono">{config.browser.resolution}</span>
          </div>
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
        <div class="field">
          <span class="field-label">Optimize Interval</span>
          <span class="field-value mono">{config.database.optimizeIntervalHours}h</span>
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
      <h2 class="group-title">Cleanup</h2>
      <div class="fields">
        <div class="field">
          <span class="field-label">Run Cleanup</span>
          <span class="field-value">
            <span class="field-dim">Delete records older than {config.database.retentionDays}d</span
            >
            <button class="btn btn-outline btn-sm" disabled={cleaningUp} onclick={runCleanup}
              >{cleaningUp ? 'Running...' : 'Run Cleanup'}</button
            >
          </span>
        </div>
      </div>
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
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
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
</style>

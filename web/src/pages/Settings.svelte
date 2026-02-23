<script lang="ts">
  import type { StatusResponse, ConfigResponse, CleanupResponse, DoctorResponse } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatUptime } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let config: ConfigResponse | null = $state(null);
  let doctor: DoctorResponse | null = $state(null);
  let loading = $state(true);

  $effect(() => {
    const ac = new AbortController();
    Promise.all([
      api<ConfigResponse>('/api/config'),
      api<DoctorResponse>('/api/doctor'),
    ])
      .then(([c, d]) => {
        if (ac.signal.aborted) return;
        config = c;
        doctor = d;
      })
      .finally(() => {
        if (!ac.signal.aborted) loading = false;
      });
    return () => ac.abort();
  });

  let cleaningUp = $state(false);

  async function runCleanup(): Promise<void> {
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
  <div class="group">
    <h2 class="group-title">System</h2>
    <div class="fields">
      <div class="field">
        <span class="field-label">Uptime</span>
        <span class="field-value">{status ? formatUptime(status.uptime) : '—'}</span>
      </div>
      <div class="field">
        <span class="field-label">Slack</span>
        <span class="field-value">
          <span
            class="dot"
            class:dot-on={status?.slack.connected}
            class:dot-off={!status?.slack.connected}
          ></span>
          {status?.slack.connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
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
        <span class="field-value mono">{(config.sessions.processTimeoutMs / 1000).toFixed(0)}s</span
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
        <span class="field-value mono">{config.slack.permissions.allowChannels.join(', ')}</span>
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
            <span class="mono">{config.slack.quietHours.start}–{config.slack.quietHours.end}</span>
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
        <span class="field-label">Max Failures</span>
        <span class="field-value mono">{config.cron.maxFailures}</span>
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

  <div class="group">
    <h2 class="group-title">Maintenance</h2>
    <div class="fields">
      <div class="field">
        <span class="field-label">Cleanup</span>
        <span class="field-value">
          <span class="field-dim">Delete records older than {config.database.retentionDays}d</span>
          <button class="btn btn-outline btn-sm" disabled={cleaningUp} onclick={runCleanup}
            >{cleaningUp ? 'Running...' : 'Run Cleanup'}</button
          >
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .group {
    margin-bottom: 1.25rem;
  }

  .group-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.5rem;
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
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }

  .field:last-child {
    border-bottom: none;
  }

  .field-label {
    font-size: 0.867rem;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .field-value {
    font-size: 0.867rem;
    color: var(--color-text-primary);
    text-align: right;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .field-dim {
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }

  .agent-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: 0.5rem;
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
    padding: 0.5rem 0.75rem;
  }

  .agent-name {
    font-size: 0.933rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .agent-id {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .dot {
    width: 7px;
    height: 7px;
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

<script lang="ts">
  import type { StatusResponse, ConfigResponse, DoctorResponse } from '../../lib/types.ts';
  import type { ConfigEditor } from './types.ts';
  import { formatUptime } from '../../lib/format.ts';
  import InlineEdit from '../../components/InlineEdit.svelte';
  import Toggle from '../../components/Toggle.svelte';
  import AgentSection from './AgentSection.svelte';

  interface Props {
    config: ConfigResponse;
    status: StatusResponse | null;
    doctor: DoctorResponse | null;
    doctorLoading: boolean;
    editor: ConfigEditor;
  }

  let { config, status, doctor, doctorLoading, editor }: Props = $props();

  let editValue = $state('');

  const configuredProviders = $derived.by(() => {
    return new Set(config.agents.map((a) => a.provider));
  });

  function handleStartEdit(field: string, currentValue: string | number): void {
    editValue = String(currentValue);
    editor.startEdit(field, currentValue);
  }
</script>

<div class="config-grid">
  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">System</span>
    </div>
    <div class="panel-body">
      {#if status}
        <div class="row">
          <span class="row-label">Uptime</span>
          <span class="row-value mono">{formatUptime(status.uptime)}</span>
        </div>
      {/if}
      <div class="row">
        <span class="row-label">Timezone</span>
        <span class="row-value">
          {#if editor.editingField === 'timezone'}
            <InlineEdit
              bind:value={editValue}
              mono
              saving={editor.editingSaving}
              onsave={(v) => editor.saveField('timezone', v)}
              oncancel={editor.cancelEdit}
            />
          {:else}
            <button
              class="val-btn mono editable"
              onclick={() => handleStartEdit('timezone', config.timezone)}>{config.timezone}</button
            >
          {/if}
        </span>
      </div>
      <div class="row">
        <span class="row-label">Web Port</span>
        <span class="row-value mono">{config.web.port}</span>
      </div>
      <div class="row">
        <span class="row-label">Agent CLI</span>
        <span class="row-value">
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
              <span class="dim">Checking...</span>
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
        <div class="row">
          <span class="row-label">Node.js</span>
          <span class="row-value mono">{doctor.node}</span>
        </div>
      {/if}
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Sessions</span>
    </div>
    <div class="panel-body">
      <div class="row">
        <span class="row-label">Max Concurrent</span>
        <span class="row-value">
          {#if editor.editingField === 'sessions.maxConcurrent'}
            <InlineEdit
              bind:value={editValue}
              mono
              saving={editor.editingSaving}
              onsave={(v) => editor.saveField('sessions.maxConcurrent', v, (s) => Number(s))}
              oncancel={editor.cancelEdit}
            />
          {:else}
            <button
              class="val-btn mono editable"
              onclick={() =>
                handleStartEdit('sessions.maxConcurrent', config.sessions.maxConcurrent)}
              >{config.sessions.maxConcurrent}</button
            >
          {/if}
        </span>
      </div>
      <div class="row">
        <span class="row-label">TTL</span>
        <span class="row-value">
          {#if editor.editingField === 'sessions.ttlHours'}
            <InlineEdit
              bind:value={editValue}
              mono
              saving={editor.editingSaving}
              onsave={(v) => editor.saveField('sessions.ttlHours', v, (s) => Number(s))}
              oncancel={editor.cancelEdit}
            />
          {:else}
            <button
              class="val-btn mono editable"
              onclick={() => handleStartEdit('sessions.ttlHours', config.sessions.ttlHours)}
              >{config.sessions.ttlHours}h</button
            >
          {/if}
        </span>
      </div>
      <div class="row">
        <span class="row-label">Timeout</span>
        <span class="row-value">
          {#if editor.editingField === 'sessions.processTimeoutMs'}
            <InlineEdit
              bind:value={editValue}
              mono
              saving={editor.editingSaving}
              onsave={(v) =>
                editor.saveField('sessions.processTimeoutMs', v, (s) =>
                  Math.round(Number(s) * 1000),
                )}
              oncancel={editor.cancelEdit}
            />
          {:else}
            <button
              class="val-btn mono editable"
              onclick={() =>
                handleStartEdit(
                  'sessions.processTimeoutMs',
                  (config.sessions.processTimeoutMs / 1000).toFixed(0),
                )}>{(config.sessions.processTimeoutMs / 1000).toFixed(0)}s</button
            >
          {/if}
        </span>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Slack</span>
      {#if status}
        <span
          class="svc-chip"
          class:svc-chip-ok={status.slack.connected}
          class:svc-chip-err={!status.slack.connected}
        >
          <span
            class="dot"
            class:dot-on={status.slack.connected}
            class:dot-off={!status.slack.connected}
          ></span>
          {status.slack.connected ? 'connected' : 'disconnected'}
        </span>
      {/if}
    </div>
    <div class="panel-body">
      <div class="row">
        <span class="row-label">Require Mention</span>
        <span class="row-value">
          <Toggle
            active={config.slack.requireMention}
            onToggle={() => editor.toggleField('slack.requireMention', config.slack.requireMention)}
          />
        </span>
      </div>
      <div class="row">
        <span class="row-label">Debounce</span>
        <span class="row-value">
          {#if editor.editingField === 'slack.coalesce.debounceMs'}
            <InlineEdit
              bind:value={editValue}
              mono
              saving={editor.editingSaving}
              onsave={(v) => editor.saveField('slack.coalesce.debounceMs', v, (s) => Number(s))}
              oncancel={editor.cancelEdit}
            />
          {:else}
            <button
              class="val-btn mono editable"
              onclick={() =>
                handleStartEdit('slack.coalesce.debounceMs', config.slack.coalesce.debounceMs)}
              >{config.slack.coalesce.debounceMs}ms</button
            >
          {/if}
        </span>
      </div>
      <div class="row">
        <span class="row-label">Bypass DMs</span>
        <span class="row-value">
          <Toggle
            active={config.slack.coalesce.bypassDms}
            onToggle={() =>
              editor.toggleField('slack.coalesce.bypassDms', config.slack.coalesce.bypassDms)}
          />
        </span>
      </div>
      <div class="row">
        <span class="row-label">Channels</span>
        <span class="row-value">
          {#if editor.editingField === 'slack.channels'}
            <InlineEdit
              bind:value={editValue}
              mono
              saving={editor.editingSaving}
              onsave={(v) =>
                editor.saveField('slack.channels', v, (s) =>
                  s
                    .split(',')
                    .map((c) => c.trim())
                    .filter(Boolean),
                )}
              oncancel={editor.cancelEdit}
            />
          {:else}
            <button
              class="val-btn mono editable"
              onclick={() => handleStartEdit('slack.channels', config.slack.channels.join(', '))}
              >{config.slack.channels.join(', ') || '*'}</button
            >
          {/if}
        </span>
      </div>
      <div class="row">
        <span class="row-label">Quiet Hours</span>
        <span class="row-value">
          <Toggle
            active={config.slack.quietHours.enabled}
            onToggle={() =>
              editor.toggleField('slack.quietHours.enabled', config.slack.quietHours.enabled)}
          />
        </span>
      </div>
      {#if config.slack.quietHours.enabled}
        <div class="row">
          <span class="row-label">Start / End</span>
          <span class="row-value">
            {#if editor.editingField === 'slack.quietHours.start'}
              <InlineEdit
                bind:value={editValue}
                mono
                saving={editor.editingSaving}
                placeholder="HH:MM"
                onsave={(v) => editor.saveField('slack.quietHours.start', v)}
                oncancel={editor.cancelEdit}
              />
            {:else}
              <button
                class="val-btn mono editable"
                onclick={() =>
                  handleStartEdit('slack.quietHours.start', config.slack.quietHours.start)}
                >{config.slack.quietHours.start}</button
              >
            {/if}
            <span class="dim">&ndash;</span>
            {#if editor.editingField === 'slack.quietHours.end'}
              <InlineEdit
                bind:value={editValue}
                mono
                saving={editor.editingSaving}
                placeholder="HH:MM"
                onsave={(v) => editor.saveField('slack.quietHours.end', v)}
                oncancel={editor.cancelEdit}
              />
            {:else}
              <button
                class="val-btn mono editable"
                onclick={() => handleStartEdit('slack.quietHours.end', config.slack.quietHours.end)}
                >{config.slack.quietHours.end}</button
              >
            {/if}
          </span>
        </div>
      {/if}
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Browser</span>
      {#if config.browser.enabled && status}
        <span
          class="svc-chip"
          class:svc-chip-ok={status.browser.connected}
          class:svc-chip-err={!status.browser.connected}
        >
          <span
            class="dot"
            class:dot-on={status.browser.connected}
            class:dot-off={!status.browser.connected}
          ></span>
          {status.browser.connected ? 'connected' : 'unreachable'}
        </span>
      {/if}
    </div>
    <div class="panel-body">
      <div class="row">
        <span class="row-label">Enabled</span>
        <span class="row-value">
          <Toggle
            active={config.browser.enabled}
            onToggle={() => editor.toggleField('browser.enabled', config.browser.enabled)}
          />
        </span>
      </div>
      {#if config.browser.enabled}
        <div class="row">
          <span class="row-label">Mode</span>
          <span class="row-value">
            <select
              class="inline-select mono"
              value={config.browser.mode}
              onchange={(e) => editor.saveConfigPatch({ browser: { mode: e.currentTarget.value } })}
            >
              <option value="persistent">persistent</option>
              <option value="isolated">isolated</option>
            </select>
          </span>
        </div>
        <div class="row">
          <span class="row-label">VNC Port</span>
          <span class="row-value mono">{config.browser.vncPort}</span>
        </div>
        <div class="row">
          <span class="row-label">noVNC Port</span>
          <span class="row-value mono">{config.browser.novncPort}</span>
        </div>
      {/if}
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Birds</span>
    </div>
    <div class="panel-body">
      <div class="row">
        <span class="row-label">Max Attempts</span>
        <span class="row-value">
          {#if editor.editingField === 'birds.maxAttempts'}
            <InlineEdit
              bind:value={editValue}
              mono
              saving={editor.editingSaving}
              onsave={(v) => editor.saveField('birds.maxAttempts', v, (s) => Number(s))}
              oncancel={editor.cancelEdit}
            />
          {:else}
            <button
              class="val-btn mono editable"
              onclick={() => handleStartEdit('birds.maxAttempts', config.birds.maxAttempts)}
              >{config.birds.maxAttempts}</button
            >
          {/if}
        </span>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <span class="panel-title">Database</span>
    </div>
    <div class="panel-body">
      <div class="row">
        <span class="row-label">Retention</span>
        <span class="row-value">
          {#if editor.editingField === 'database.retentionDays'}
            <InlineEdit
              bind:value={editValue}
              mono
              saving={editor.editingSaving}
              onsave={(v) => editor.saveField('database.retentionDays', v, (s) => Number(s))}
              oncancel={editor.cancelEdit}
            />
          {:else}
            <button
              class="val-btn mono editable"
              onclick={() =>
                handleStartEdit('database.retentionDays', config.database.retentionDays)}
              >{config.database.retentionDays} days</button
            >
          {/if}
        </span>
      </div>
    </div>
  </div>
</div>

<AgentSection {config} {editor} />

<style>
  .config-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-5);
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

  @media (max-width: 960px) {
    .config-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

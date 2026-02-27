<script lang="ts">
  import type {
    StatusResponse,
    ConfigResponse,
    DoctorResponse,
    SecretsResponse,
    SecretHint,
  } from '../../lib/types.ts';
  import type { ConfigEditor } from './types.ts';
  import { api } from '../../lib/api.ts';
  import { showToast } from '../../lib/toast.svelte.ts';
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
    secrets: SecretsResponse | null;
    onsecretsupdate: () => void;
  }

  let { config, status, doctor, doctorLoading, editor, secrets, onsecretsupdate }: Props = $props();

  let editValue = $state('');

  const configuredProviders = $derived.by(() => {
    return new Set(config.agents.map((a) => a.provider));
  });

  function handleStartEdit(field: string, currentValue: string | number): void {
    editValue = String(currentValue);
    editor.startEdit(field, currentValue);
  }

  type SecretField = 'slackBotToken' | 'slackAppToken' | 'apiKey';

  let secretEditing: SecretField | null = $state(null);
  let secretValue = $state('');
  let secretSaving = $state(false);
  let slackRestartNotice = $state(false);

  function startSecretEdit(field: SecretField): void {
    secretEditing = field;
    secretValue = '';
  }

  function cancelSecretEdit(): void {
    secretEditing = null;
    secretSaving = false;
  }

  async function saveSecret(): Promise<void> {
    if (!secretEditing || !secretValue.trim()) return;
    secretSaving = true;

    try {
      if (secretEditing === 'slackBotToken' || secretEditing === 'slackAppToken') {
        const body =
          secretEditing === 'slackBotToken'
            ? { botToken: secretValue.trim() }
            : { appToken: secretValue.trim() };
        const result = await api<{ success: boolean; requiresRestart: boolean }>(
          '/api/secrets/slack',
          { method: 'PUT', body },
        );
        showToast('Slack token saved', 'success');
        if (result.requiresRestart) slackRestartNotice = true;
      } else {
        await api<{ success: boolean; requiresRestart: boolean }>('/api/secrets/anthropic', {
          method: 'PUT',
          body: { apiKey: secretValue.trim() },
        });
        showToast('API key saved (effective next session)', 'success');
      }
      secretEditing = null;
      secretValue = '';
      onsecretsupdate();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      secretSaving = false;
    }
  }

  function handleSecretKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') cancelSecretEdit();
    else if (e.key === 'Enter') {
      e.preventDefault();
      saveSecret();
    }
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
      <div class="row">
        <span class="row-label">API Key</span>
        <span class="row-value">
          {#if secretEditing === 'apiKey'}
            <div class="secret-edit">
              <input
                type="password"
                autocomplete="off"
                class="secret-input mono"
                placeholder="sk-ant-..."
                bind:value={secretValue}
                onkeydown={handleSecretKeydown}
              />
              <button
                class="inline-btn inline-btn-save"
                disabled={secretSaving || !secretValue}
                onclick={saveSecret}
                title="Save"
              >
                {#if secretSaving}...{:else}
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
                    ><path
                      d="M3 8.5l3.5 3.5L13 4.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    /></svg
                  >{/if}
              </button>
              <button
                class="inline-btn inline-btn-cancel"
                onclick={cancelSecretEdit}
                title="Cancel"
              >
                <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
                  ><path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  /></svg
                >
              </button>
            </div>
          {:else if secrets}
            <button class="val-btn mono editable" onclick={() => startSecretEdit('apiKey')}
              >{secrets.anthropic.set ? secrets.anthropic.hint : 'not set'}</button
            >
          {:else}
            <span class="dim">...</span>
          {/if}
        </span>
      </div>
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
      {#if slackRestartNotice}
        <div class="notice">Restart the daemon to apply new Slack tokens.</div>
      {/if}
      {#snippet secretRow(
        field: SecretField,
        label: string,
        placeholder: string,
        hint: SecretHint | undefined,
      )}
        <div class="row">
          <span class="row-label">{label}</span>
          <span class="row-value">
            {#if secretEditing === field}
              <div class="secret-edit">
                <input
                  type="password"
                  autocomplete="off"
                  class="secret-input mono"
                  {placeholder}
                  bind:value={secretValue}
                  onkeydown={handleSecretKeydown}
                />
                <button
                  class="inline-btn inline-btn-save"
                  disabled={secretSaving || !secretValue}
                  onclick={saveSecret}
                  title="Save"
                >
                  {#if secretSaving}...{:else}
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
                      ><path
                        d="M3 8.5l3.5 3.5L13 4.5"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      /></svg
                    >{/if}
                </button>
                <button
                  class="inline-btn inline-btn-cancel"
                  onclick={cancelSecretEdit}
                  title="Cancel"
                >
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
                    ><path
                      d="M4 4l8 8M12 4l-8 8"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    /></svg
                  >
                </button>
              </div>
            {:else if hint}
              <button class="val-btn mono editable" onclick={() => startSecretEdit(field)}
                >{hint.set ? hint.hint : 'not set'}</button
              >
            {:else}
              <span class="dim">...</span>
            {/if}
          </span>
        </div>
      {/snippet}
      {@render secretRow('slackBotToken', 'Bot Token', 'xoxb-...', secrets?.slack.botToken)}
      {@render secretRow('slackAppToken', 'App Token', 'xapp-...', secrets?.slack.appToken)}
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
          <span class="row-label">VM Host</span>
          <span class="row-value">
            {#if editor.editingField === 'browser.novncHost'}
              <InlineEdit
                bind:value={editValue}
                mono
                saving={editor.editingSaving}
                onsave={(v) => editor.saveField('browser.novncHost', v)}
                oncancel={editor.cancelEdit}
              />
            {:else}
              <button
                class="val-btn mono editable"
                onclick={() => handleStartEdit('browser.novncHost', config.browser.novncHost)}
              >{config.browser.novncHost}</button>
            {/if}
          </span>
        </div>
        <div class="row">
          <span class="row-label">Mode</span>
          <span class="row-value mono">{config.browser.mode}</span>
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

  .secret-edit {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .secret-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-1-5);
    background: var(--color-bg-deep);
    border: 1px solid var(--color-accent-dim);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.1);
  }

  .secret-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.18);
  }

  .inline-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .inline-btn svg {
    width: 12px;
    height: 12px;
  }

  .inline-btn-save {
    background: var(--color-accent-dim);
    color: var(--color-text-primary);
  }

  .inline-btn-save:hover {
    background: var(--color-accent);
  }

  .inline-btn-save:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .inline-btn-cancel {
    background: transparent;
    color: var(--color-text-muted);
  }

  .inline-btn-cancel:hover {
    background: var(--color-bg-elevated);
    color: var(--color-text-secondary);
  }

  .notice {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
    color: var(--color-warning);
    background: var(--color-warning-bg);
    border-bottom: 1px solid rgba(230, 180, 60, 0.2);
  }

  @media (max-width: 960px) {
    .config-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

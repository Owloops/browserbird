<script lang="ts">
  import type { OnboardingDefaults } from '../lib/types.ts';
  import Toggle from '../components/Toggle.svelte';
  import {
    getOnboardingDefaults,
    validateSlackTokens,
    saveAgentConfig,
    saveAuthConfig,
    saveBrowserConfig,
    completeOnboarding,
    probeBrowserConnection,
  } from '../lib/api.ts';

  interface Props {
    oncomplete: () => void;
  }

  let { oncomplete }: Props = $props();

  const STEPS = ['Agent', 'Slack', 'Browser'] as const;
  const SLACK_MANIFEST_URL =
    'https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22BrowserBird%22%2C%22description%22%3A%22A%20self-hosted%20AI%20assistant%20in%20Slack%2C%20with%20a%20real%20browser%20and%20a%20scheduler.%22%2C%22background_color%22%3A%22%231a1a2e%22%7D%2C%22features%22%3A%7B%22assistant_view%22%3A%7B%22assistant_description%22%3A%22A%20self-hosted%20AI%20assistant%20in%20Slack%2C%20with%20a%20real%20browser%20and%20a%20scheduler.%22%7D%2C%22app_home%22%3A%7B%22home_tab_enabled%22%3Atrue%2C%22messages_tab_enabled%22%3Atrue%2C%22messages_tab_read_only_enabled%22%3Afalse%7D%2C%22bot_user%22%3A%7B%22display_name%22%3A%22BrowserBird%22%2C%22always_online%22%3Atrue%7D%2C%22slash_commands%22%3A%5B%7B%22command%22%3A%22%2Fbird%22%2C%22description%22%3A%22Manage%20BrowserBird%20birds%22%2C%22usage_hint%22%3A%22list%20%7C%20fly%20%7C%20logs%20%7C%20enable%20%7C%20disable%20%7C%20create%20%7C%20status%22%2C%22should_escape%22%3Afalse%7D%5D%7D%2C%22oauth_config%22%3A%7B%22scopes%22%3A%7B%22bot%22%3A%5B%22app_mentions%3Aread%22%2C%22assistant%3Awrite%22%2C%22channels%3Ahistory%22%2C%22channels%3Aread%22%2C%22chat%3Awrite%22%2C%22files%3Aread%22%2C%22files%3Awrite%22%2C%22groups%3Ahistory%22%2C%22groups%3Aread%22%2C%22im%3Ahistory%22%2C%22im%3Aread%22%2C%22im%3Awrite%22%2C%22mpim%3Ahistory%22%2C%22mpim%3Aread%22%2C%22reactions%3Aread%22%2C%22reactions%3Awrite%22%2C%22users%3Aread%22%2C%22commands%22%5D%7D%7D%2C%22settings%22%3A%7B%22event_subscriptions%22%3A%7B%22bot_events%22%3A%5B%22app_mention%22%2C%22assistant_thread_context_changed%22%2C%22assistant_thread_started%22%2C%22message.channels%22%2C%22message.groups%22%2C%22message.im%22%2C%22message.mpim%22%5D%7D%2C%22interactivity%22%3A%7B%22is_enabled%22%3Atrue%7D%2C%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Atrue%2C%22token_rotation_enabled%22%3Afalse%7D%7D';

  let step = $state(0);
  let loading = $state(false);
  let error = $state('');

  let slackData = $state({ botToken: '', appToken: '', team: '', botUser: '' });
  let agentData = $state({
    name: 'BrowserBird',
    provider: 'claude',
    model: 'sonnet',
    systemPrompt: 'You are a helpful AI assistant. Be concise and direct.',
    maxTurns: 50,
    channels: ['*'],
    apiKey: '',
  });
  let browserData = $state({ enabled: false, novncHost: 'localhost', novncPort: 6080 });

  let probeState: 'idle' | 'checking' | 'reachable' | 'unreachable' = $state('idle');

  let defaults: OnboardingDefaults | null = $state(null);

  $effect(() => {
    getOnboardingDefaults()
      .then((d) => {
        defaults = d;
        agentData.name = d.agent.name;
        agentData.provider = d.agent.provider;
        agentData.model = d.agent.model;
        agentData.systemPrompt = d.agent.systemPrompt;
        agentData.maxTurns = d.agent.maxTurns;
        agentData.channels = d.agent.channels;
        browserData.enabled = d.browser.enabled;
        browserData.novncHost = d.browser.novncHost;
        browserData.novncPort = d.browser.novncPort;
      })
      .catch(() => {
        /* defaults are pre-filled, not critical */
      });
  });

  async function handleSlackSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!slackData.botToken.trim() || !slackData.appToken.trim()) return;
    loading = true;
    error = '';
    try {
      const result = await validateSlackTokens(
        slackData.botToken.trim(),
        slackData.appToken.trim(),
      );
      slackData.team = result.team;
      slackData.botUser = result.botUser;
      step = 2;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleAgentSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!agentData.name.trim() || !agentData.provider.trim() || !agentData.model.trim()) return;
    if (!agentData.apiKey.trim()) {
      error = 'API key is required';
      return;
    }
    loading = true;
    error = '';
    try {
      await saveAgentConfig({
        name: agentData.name.trim(),
        provider: agentData.provider.trim(),
        model: agentData.model.trim(),
        systemPrompt: agentData.systemPrompt.trim(),
        maxTurns: agentData.maxTurns,
        channels: agentData.channels,
      });
      await saveAuthConfig({ apiKey: agentData.apiKey.trim() });
      step = 1;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function skipSlack(): void {
    step = 2;
  }

  async function handleBrowserSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    loading = true;
    error = '';
    try {
      await saveBrowserConfig({
        enabled: browserData.enabled,
        novncHost: browserData.enabled ? browserData.novncHost.trim() : undefined,
      });
      await launchAndFinish();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function skipBrowser(): Promise<void> {
    loading = true;
    error = '';
    try {
      await launchAndFinish();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  let launched = $state(false);

  async function launchAndFinish(): Promise<void> {
    await completeOnboarding();
    launched = true;
    step = 3;
  }

  async function handleRetryLaunch(): Promise<void> {
    loading = true;
    error = '';
    try {
      await launchAndFinish();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleProbe(): Promise<void> {
    const host = browserData.novncHost.trim();
    if (!host) return;
    probeState = 'checking';
    try {
      const result = await probeBrowserConnection(host, browserData.novncPort);
      probeState = result.reachable ? 'reachable' : 'unreachable';
    } catch {
      probeState = 'unreachable';
    }
  }

  function back(): void {
    error = '';
    if (step === 3 && !launched) {
      step = 2;
    } else {
      step--;
    }
  }
</script>

<div class="login-overlay">
  <div class="onboarding-card">
    <div class="onboarding-brand">
      <img src="/logo.svg" alt="BrowserBird" class="login-logo" />
    </div>

    {#if step < STEPS.length}
      <div class="step-indicator">
        {#each STEPS as label, i}
          <div class="step-dot" class:active={i === step} class:completed={i < step}>
            <span class="step-number">{i + 1}</span>
          </div>
          {#if i < STEPS.length - 1}
            <div class="step-line" class:completed={i < step}></div>
          {/if}
        {/each}
      </div>
    {/if}

    <h2 class="onboarding-heading">
      {#if step === 0}
        Configure Agent
      {:else if step === 1}
        Connect Slack
      {:else if step === 2}
        Browser
      {:else}
        {launched ? "You're all set" : 'Launching...'}
      {/if}
    </h2>

    {#if step === 0}
      <p class="onboarding-desc">
        Configure your first agent. You can add more agents and change settings later.
      </p>
      <form onsubmit={handleAgentSubmit}>
        <label class="form-label">
          Name
          <input
            type="text"
            class="form-input"
            placeholder="BrowserBird"
            bind:value={agentData.name}
          />
        </label>
        <div class="form-row">
          <label class="form-label">
            Provider
            <select class="form-input" bind:value={agentData.provider}>
              <option value="claude">Claude</option>
              <option value="opencode">OpenCode</option>
            </select>
          </label>
          <label class="form-label">
            Model
            <input
              type="text"
              class="form-input"
              placeholder="sonnet"
              bind:value={agentData.model}
            />
          </label>
        </div>
        <label class="form-label">
          System Prompt
          <textarea class="form-textarea" rows="3" bind:value={agentData.systemPrompt}></textarea>
        </label>
        <label class="form-label">
          Anthropic Key
          <input
            type="password"
            class="form-input"
            placeholder="sk-ant-..."
            autocomplete="off"
            bind:value={agentData.apiKey}
          />
          <span class="form-hint">API key from platform.claude.com/settings/keys</span>
        </label>
        {#if error}
          <div class="login-error">{error}</div>
        {/if}
        <button type="submit" class="btn btn-primary onboarding-submit" disabled={loading}>
          {loading ? 'Saving...' : 'Save & Continue'}
        </button>
      </form>
    {:else if step === 1}
      <p class="onboarding-desc">
        <a href={SLACK_MANIFEST_URL} target="_blank" rel="noopener" class="onboarding-link"
          >Create a Slack app from the manifest</a
        >. You can skip this and add Slack later from Settings.
      </p>
      <form onsubmit={handleSlackSubmit}>
        <label class="form-label">
          Bot Token
          <input
            type="password"
            class="form-input"
            placeholder="xoxb-..."
            autocomplete="off"
            bind:value={slackData.botToken}
          />
          <span class="form-hint"
            >OAuth & Permissions, click "Install to Workspace", then copy the token</span
          >
        </label>
        <label class="form-label">
          App Token
          <input
            type="password"
            class="form-input"
            placeholder="xapp-..."
            autocomplete="off"
            bind:value={slackData.appToken}
          />
          <span class="form-hint"
            >Basic Information, click "Generate Token and Scopes", add connections:write, then copy
            the token</span
          >
        </label>
        {#if error}
          <div class="login-error">{error}</div>
        {/if}
        <div class="onboarding-actions">
          <button type="button" class="btn btn-outline" onclick={back}>Back</button>
          <div class="onboarding-actions-right">
            <button type="button" class="btn btn-outline" disabled={loading} onclick={skipSlack}>
              Skip
            </button>
            <button type="submit" class="btn btn-primary" disabled={loading}>
              {loading ? 'Validating...' : 'Validate & Save'}
            </button>
          </div>
        </div>
      </form>
    {:else if step === 2}
      <p class="onboarding-desc">
        Optionally enable browser access for your agent. You can configure this later.
      </p>
      <form onsubmit={handleBrowserSubmit}>
        <div class="browser-toggle">
          <span class="browser-toggle-label">Enable browser</span>
          <Toggle
            active={browserData.enabled}
            onToggle={() => {
              browserData.enabled = !browserData.enabled;
              probeState = 'idle';
            }}
          />
        </div>
        {#if browserData.enabled}
          <label class="form-label">
            VM Host
            <div class="probe-row">
              <input
                type="text"
                class="form-input"
                placeholder="vm"
                bind:value={browserData.novncHost}
                oninput={() => {
                  probeState = 'idle';
                }}
              />
              <button
                type="button"
                class="btn btn-outline btn-sm"
                disabled={probeState === 'checking' || !browserData.novncHost.trim()}
                onclick={handleProbe}
              >
                {probeState === 'checking' ? 'Checking...' : 'Test Connection'}
              </button>
            </div>
            <span class="form-hint">
              Hostname of the VM container (e.g. vm, vm.internal, localhost)
            </span>
          </label>
          {#if probeState === 'reachable'}
            <div class="probe-result probe-ok">Connected</div>
          {:else if probeState === 'unreachable'}
            <div class="probe-result probe-fail">
              Not reachable. Make sure the VM container is running.
            </div>
          {/if}
        {/if}
        {#if error}
          <div class="login-error">{error}</div>
        {/if}
        <div class="onboarding-actions">
          <button type="button" class="btn btn-outline" onclick={back}>Back</button>
          <div class="onboarding-actions-right">
            <button type="button" class="btn btn-outline" disabled={loading} onclick={skipBrowser}>
              {loading ? 'Launching...' : 'Skip'}
            </button>
            <button type="submit" class="btn btn-primary" disabled={loading}>
              {loading ? 'Launching...' : 'Save & Launch'}
            </button>
          </div>
        </div>
      </form>
    {:else if launched}
      <div class="launch-summary">
        <div class="summary-row">
          <span class="summary-label">Slack</span>
          <span class="summary-value">{slackData.team || 'Not configured'}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Agent</span>
          <span class="summary-value"
            >{agentData.name} ({agentData.provider}/{agentData.model})</span
          >
        </div>
        <div class="summary-row">
          <span class="summary-label">Browser</span>
          <span class="summary-value">{browserData.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>
      <div class="done-tips">
        {#if slackData.team}
          <div class="done-tip">
            <span class="done-tip-label">Mention your bot</span>
            <span class="done-tip-detail">@{agentData.name} in any channel</span>
          </div>
          <div class="done-tip">
            <span class="done-tip-label">Direct message</span>
            <span class="done-tip-detail">Open a DM with your bot in Slack</span>
          </div>
          <div class="done-tip">
            <span class="done-tip-label">Slash commands</span>
            <span class="done-tip-detail">Type /bird in Slack to manage scheduled tasks</span>
          </div>
          <div class="done-tip">
            <span class="done-tip-label">Scheduled tasks</span>
            <span class="done-tip-detail"
              >Create birds from the dashboard, via /bird create, or ask your bot in Slack</span
            >
          </div>
        {:else}
          <div class="done-tip">
            <span class="done-tip-label">Create birds</span>
            <span class="done-tip-detail"
              >Schedule tasks from the Birds page or the CLI</span
            >
          </div>
          <div class="done-tip">
            <span class="done-tip-label">Add Slack later</span>
            <span class="done-tip-detail"
              >Go to Settings to connect Slack whenever you are ready</span
            >
          </div>
        {/if}
      </div>
      <button type="button" class="btn btn-primary onboarding-submit" onclick={oncomplete}>
        Go to Dashboard
      </button>
    {:else}
      {#if error}
        <div class="login-error">{error}</div>
      {/if}
      <div class="onboarding-actions">
        <button type="button" class="btn btn-outline" onclick={back}>Back</button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={loading}
          onclick={handleRetryLaunch}
        >
          {loading ? 'Launching...' : 'Retry'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .login-overlay {
    position: fixed;
    inset: 0;
    background: var(--color-bg-deep);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .onboarding-card {
    background: color-mix(in srgb, var(--color-bg-surface) 92%, transparent);
    backdrop-filter: blur(16px);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-8) var(--space-6);
    width: 100%;
    max-width: 420px;
    box-shadow: var(--shadow-elevated);
  }

  .onboarding-brand {
    text-align: center;
    margin-bottom: var(--space-5);
  }

  .onboarding-brand :global(.login-logo) {
    height: 36px;
    width: auto;
  }

  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin-bottom: var(--space-5);
  }

  .step-dot {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    border: 2px solid var(--color-border-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }

  .step-dot.active {
    border-color: var(--color-accent);
    background: var(--color-accent-bg);
  }

  .step-dot.completed {
    border-color: var(--color-success);
    background: var(--color-success-bg);
  }

  .step-number {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    line-height: 1;
  }

  .step-dot.active .step-number {
    color: var(--color-accent);
  }

  .step-dot.completed .step-number {
    color: var(--color-success);
  }

  .step-line {
    width: 28px;
    height: 2px;
    background: var(--color-border-subtle);
    transition: background var(--transition-fast);
  }

  .step-line.completed {
    background: var(--color-success);
  }

  .onboarding-heading {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--color-text-primary);
    text-align: center;
    margin-bottom: var(--space-2);
  }

  .onboarding-desc {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-align: center;
    margin-bottom: var(--space-4);
    line-height: 1.5;
  }

  .onboarding-link {
    color: var(--color-accent);
    text-decoration: none;
  }

  .onboarding-link:hover {
    text-decoration: underline;
  }

  .onboarding-submit {
    width: 100%;
    margin-top: var(--space-2);
  }

  .onboarding-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .onboarding-actions-right {
    display: flex;
    gap: var(--space-2);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .form-hint {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-1);
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
  }

  .browser-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-3);
  }

  .browser-toggle-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .probe-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .probe-row .form-input {
    flex: 1;
  }

  .probe-result {
    font-size: var(--text-sm);
    margin-top: var(--space-1);
    margin-bottom: var(--space-2);
  }

  .probe-ok {
    color: var(--color-success);
  }

  .probe-fail {
    color: var(--color-text-muted);
  }

  .launch-summary {
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .summary-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-1-5) 0;
  }

  .summary-row + .summary-row {
    border-top: 1px solid var(--color-border);
  }

  .summary-label {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 500;
  }

  .summary-value {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
  }

  .done-tips {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }

  .done-tip {
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }

  .done-tip-label {
    display: block;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: var(--space-1);
  }

  .done-tip-detail {
    display: block;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .login-error {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin-bottom: var(--space-2-5);
  }

  @media (max-width: 480px) {
    .onboarding-card {
      max-width: 100%;
      margin: var(--space-2);
    }

    .form-row {
      grid-template-columns: 1fr;
    }

    .probe-row {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>

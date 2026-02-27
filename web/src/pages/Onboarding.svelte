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
  } from '../lib/api.ts';

  interface Props {
    oncomplete: () => void;
  }

  let { oncomplete }: Props = $props();

  const STEPS = ['Slack', 'Agent', 'Browser'] as const;
  const SLACK_APPS_URL = 'https://api.slack.com/apps';
  const MANIFEST_URL = 'https://raw.githubusercontent.com/Owloops/browserbird/main/manifest.json';

  let step = $state(0);
  let loading = $state(false);
  let error = $state('');

  let slackData = $state({ botToken: '', appToken: '', team: '', botUser: '' });
  let agentData = $state({
    name: 'BrowserBird',
    provider: 'claude',
    model: 'sonnet',
    systemPrompt: 'You are responding in a Slack workspace. Be concise, helpful, and natural.',
    maxTurns: 50,
    channels: ['*'],
    apiKey: '',
  });
  let browserData = $state({ enabled: false, mode: 'persistent' });

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
        browserData.mode = d.browser.mode;
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
      step = 1;
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
      step = 2;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function handleBrowserSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    loading = true;
    error = '';
    try {
      await saveBrowserConfig({
        enabled: browserData.enabled,
        mode: browserData.mode,
      });
      step = 3;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function skipBrowser(): void {
    step = 3;
  }

  let launched = $state(false);

  async function handleLaunch(): Promise<void> {
    loading = true;
    error = '';
    try {
      await completeOnboarding();
      launched = true;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function back(): void {
    error = '';
    step--;
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
        Connect Slack
      {:else if step === 1}
        Configure Agent
      {:else if step === 2}
        Browser
      {:else}
        {launched ? "You're all set" : 'Review & Launch'}
      {/if}
    </h2>

    {#if step === 0}
      <p class="onboarding-desc">
        Create a Slack app at
        <a href={SLACK_APPS_URL} target="_blank" rel="noopener" class="onboarding-link"
          >api.slack.com/apps</a
        >
        using the
        <a href={MANIFEST_URL} target="_blank" rel="noopener" class="onboarding-link"
          >manifest.json</a
        >.
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
        <button type="submit" class="btn btn-primary onboarding-submit" disabled={loading}>
          {loading ? 'Validating...' : 'Validate & Save'}
        </button>
      </form>
    {:else if step === 1}
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
        <div class="onboarding-actions">
          <button type="button" class="btn btn-outline" onclick={back}>Back</button>
          <button type="submit" class="btn btn-primary" disabled={loading}>
            {loading ? 'Saving...' : 'Save & Continue'}
          </button>
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
            onToggle={() => (browserData.enabled = !browserData.enabled)}
          />
        </div>
        {#if browserData.enabled}
          <label class="form-label">
            Mode
            <select class="form-input" bind:value={browserData.mode}>
              <option value="persistent">Persistent</option>
              <option value="isolated">Isolated</option>
            </select>
          </label>
        {/if}
        {#if error}
          <div class="login-error">{error}</div>
        {/if}
        <div class="onboarding-actions">
          <button type="button" class="btn btn-outline" onclick={back}>Back</button>
          <div class="onboarding-actions-right">
            <button type="button" class="btn btn-outline" onclick={skipBrowser}>Skip</button>
            <button type="submit" class="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save & Continue'}
            </button>
          </div>
        </div>
      </form>
    {:else}
      <div class="launch-summary">
        <div class="summary-row">
          <span class="summary-label">Slack</span>
          <span class="summary-value">{slackData.team || 'Connected'}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Agent</span>
          <span class="summary-value"
            >{agentData.name} ({agentData.provider}/{agentData.model})</span
          >
        </div>
        <div class="summary-row">
          <span class="summary-label">Browser</span>
          <span class="summary-value">{browserData.enabled ? browserData.mode : 'Disabled'}</span>
        </div>
      </div>
      {#if launched}
        <div class="done-tips">
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
          <button type="button" class="btn btn-primary" disabled={loading} onclick={handleLaunch}>
            {loading ? 'Starting...' : 'Start BrowserBird'}
          </button>
        </div>
      {/if}
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
  }
</style>

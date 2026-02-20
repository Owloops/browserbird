<script lang="ts">
  import type { StatusResponse, ConfigResponse } from '../lib/types.ts';
  import { api } from '../lib/api.ts';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let config: ConfigResponse | null = $state(null);
  let loading = $state(true);
  let iframeError = $state(false);

  const browserEnabled = $derived(status?.browser.enabled ?? false);

  $effect(() => {
    const ac = new AbortController();
    api<ConfigResponse>('/api/config')
      .then((c) => {
        if (!ac.signal.aborted) config = c;
      })
      .finally(() => {
        if (!ac.signal.aborted) loading = false;
      });
    return () => ac.abort();
  });

  const novncUrl = $derived.by(() => {
    if (!config?.browser) return '';
    const host = window.location.hostname;
    const port = config.browser.novncPort;
    return `http://${host}:${port}/vnc.html?autoconnect=true&resize=scale&reconnect=true&reconnect_delay=1000`;
  });

  function handleIframeLoad(): void {
    iframeError = false;
  }

  function handleIframeError(): void {
    iframeError = true;
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else if !browserEnabled}
  <div class="disabled-state">
    <div class="disabled-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    </div>
    <h2 class="disabled-title">Browser Not Enabled</h2>
    <p class="disabled-text">
      The visible browser requires Docker with Xvfb, x11vnc, and noVNC.
    </p>
    <div class="disabled-steps">
      <div class="step">
        <span class="step-num">1</span>
        <span class="step-text">Set <code>browser.enabled: true</code> in your config</span>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <span class="step-text">Run with <code>podman-compose up</code></span>
      </div>
      <div class="step">
        <span class="step-num">3</span>
        <span class="step-text">Open this page to view the virtual desktop</span>
      </div>
    </div>
  </div>
{:else}
  <div class="browser-viewer">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="conn-dot" class:conn-on={!iframeError} class:conn-off={iframeError}></span>
        <span class="toolbar-label">{iframeError ? 'Disconnected' : 'Connected'}</span>
      </div>
      {#if config?.browser}
        <div class="toolbar-right">
          <span class="toolbar-meta">
            <span class="toolbar-dim">Display</span>
            <span class="mono">{config.browser.display}</span>
          </span>
          <span class="toolbar-sep"></span>
          <span class="toolbar-meta">
            <span class="toolbar-dim">Resolution</span>
            <span class="mono">{config.browser.resolution}</span>
          </span>
          <span class="toolbar-sep"></span>
          <span class="toolbar-meta">
            <span class="toolbar-dim">VNC</span>
            <span class="mono">:{config.browser.vncPort}</span>
          </span>
        </div>
      {/if}
    </div>

    <div class="iframe-container">
      {#if iframeError}
        <div class="error-overlay">
          <p class="error-text">Could not connect to noVNC</p>
          <p class="error-hint">Ensure the browser stack is running on port {config?.browser.novncPort ?? 6080}</p>
          <button class="btn btn-outline btn-sm" onclick={() => { iframeError = false; }}>
            Retry
          </button>
        </div>
      {/if}
      {#if novncUrl && !iframeError}
        <iframe
          src={novncUrl}
          title="Virtual Desktop (noVNC)"
          class="vnc-iframe"
          onload={handleIframeLoad}
          onerror={handleIframeError}
        ></iframe>
      {/if}
    </div>
  </div>
{/if}

<style>
  .disabled-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1.25rem;
    text-align: center;
  }

  .disabled-icon {
    color: var(--color-text-muted);
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .disabled-title {
    font-size: 1.067rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-bottom: 0.5rem;
  }

  .disabled-text {
    font-size: 0.867rem;
    color: var(--color-text-muted);
    max-width: 400px;
    margin-bottom: 1.5rem;
  }

  .disabled-steps {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    text-align: left;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .step-num {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    font-size: 0.733rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .step-text {
    font-size: 0.833rem;
    color: var(--color-text-secondary);
  }

  .step-text code {
    font-family: var(--font-mono);
    font-size: 0.769rem;
    background: var(--color-bg-elevated);
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
  }

  .browser-viewer {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 7rem);
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.75rem;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-bottom: 0.625rem;
    flex-shrink: 0;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .conn-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .conn-on {
    background: var(--color-success);
    box-shadow: 0 0 4px var(--color-success);
  }

  .conn-off {
    background: var(--color-error);
    box-shadow: 0 0 4px var(--color-error);
  }

  .toolbar-label {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
  }

  .toolbar-meta {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.769rem;
  }

  .toolbar-dim {
    color: var(--color-text-muted);
  }

  .toolbar-sep {
    width: 1px;
    height: 14px;
    background: var(--color-border);
  }

  .iframe-container {
    flex: 1;
    position: relative;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-bg-surface);
  }

  .vnc-iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }

  .error-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-surface);
    gap: 0.5rem;
  }

  .error-text {
    font-size: 0.933rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .error-hint {
    font-size: 0.8rem;
    color: var(--color-text-muted);
    margin-bottom: 0.375rem;
  }
</style>

<script lang="ts">
  import type { StatusResponse, ConfigResponse } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import RFB from '@novnc/novnc';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let config: ConfigResponse | null = $state(null);
  let loading = $state(true);
  let connState: 'connecting' | 'connected' | 'disconnected' | 'failed' = $state('connecting');
  let viewerEl: HTMLDivElement | undefined = $state();
  let connectKey = $state(0);
  let rfbInstance: InstanceType<typeof RFB> | null = $state(null);
  let clipboardOpen = $state(false);
  let clipboardText = $state('');
  let connInfoOpen = $state(false);

  const browserEnabled = $derived(status?.browser.enabled ?? false);

  const connStateLabels: Record<'connecting' | 'connected' | 'disconnected' | 'failed', string> = {
    connecting: 'Connecting',
    connected: 'Connected',
    disconnected: 'Disconnected',
    failed: 'Failed',
  };
  const connStateLabel = $derived(connStateLabels[connState]);

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

  const wsUrl = $derived.by(() => {
    if (!config?.browser) return '';
    const host = window.location.hostname;
    const port = config.browser.novncPort;
    return `ws://${host}:${port}`;
  });

  $effect(() => {
    if (!browserEnabled || !wsUrl || !viewerEl || connectKey < 0) return;

    connState = 'connecting';
    let rfb: InstanceType<typeof RFB> | null = null;

    try {
      rfb = new RFB(viewerEl, wsUrl);
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfbInstance = rfb;

      rfb.addEventListener('connect', () => {
        connState = 'connected';
      });
      rfb.addEventListener('disconnect', (e: Event) => {
        const detail = (e as CustomEvent<{ clean: boolean }>).detail;
        connState = detail.clean ? 'disconnected' : 'failed';
        rfbInstance = null;
      });
    } catch {
      connState = 'failed';
      rfbInstance = null;
    }

    return () => {
      rfb?.disconnect();
      rfbInstance = null;
    };
  });

  function reconnect(): void {
    connState = 'connecting';
    connectKey += 1;
  }

  function disconnect(): void {
    rfbInstance?.disconnect();
  }

  function toggleClipboard(): void {
    clipboardOpen = !clipboardOpen;
    clipboardText = '';
  }

  function onClipboardInput(): void {
    if (!rfbInstance) return;
    rfbInstance.clipboardPasteFrom(clipboardText);
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
        <button
          class="conn-status"
          onclick={() => { connInfoOpen = !connInfoOpen; }}
        >
          <span
            class="conn-dot"
            class:conn-connecting={connState === 'connecting'}
            class:conn-on={connState === 'connected'}
            class:conn-off={connState === 'disconnected' || connState === 'failed'}
          ></span>
          <span class="toolbar-label">{connStateLabel}</span>
        </button>
        {#if connInfoOpen && config?.browser}
          <div class="conn-info-popover">
            <div class="conn-info-row">
              <span class="conn-info-key">Display</span>
              <span class="mono conn-info-val">{config.browser.display}</span>
            </div>
            <div class="conn-info-row">
              <span class="conn-info-key">Resolution</span>
              <span class="mono conn-info-val">{config.browser.resolution}</span>
            </div>
            <div class="conn-info-row">
              <span class="conn-info-key">VNC port</span>
              <span class="mono conn-info-val">{config.browser.vncPort}</span>
            </div>
            <div class="conn-info-row">
              <span class="conn-info-key">noVNC port</span>
              <span class="mono conn-info-val">{config.browser.novncPort}</span>
            </div>
          </div>
        {/if}
      </div>
      {#if config?.browser}
        <div class="toolbar-right">
          <span class="toolbar-sep"></span>
          <button
            class="toolbar-btn"
            class:toolbar-btn-active={clipboardOpen}
            onclick={toggleClipboard}
            disabled={connState !== 'connected'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="2" width="6" height="4" rx="1" />
              <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
            </svg>
            Clipboard
          </button>
          {#if connState === 'connected'}
            <button class="toolbar-btn toolbar-btn-danger" onclick={disconnect}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Disconnect
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="vnc-container">
      {#if clipboardOpen}
        <div class="clipboard-popover">
          <p class="clipboard-label">Type or paste — then use Ctrl+V inside the desktop</p>
          <textarea
            class="clipboard-textarea"
            bind:value={clipboardText}
            oninput={onClipboardInput}
            placeholder="Paste text here…"
            rows={4}
          ></textarea>
        </div>
      {/if}
      {#if connState === 'failed' || connState === 'disconnected'}
        <div class="error-overlay">
          <p class="error-text">
            {connState === 'failed' ? 'Connection failed' : 'Disconnected'}
          </p>
          <p class="error-hint">
            Ensure the browser stack is running on port {config?.browser.novncPort ?? 6080}
          </p>
          <button class="btn btn-outline btn-sm" onclick={reconnect}>Reconnect</button>
        </div>
      {/if}
      <div bind:this={viewerEl} class="vnc-canvas" class:vnc-hidden={connState !== 'connected'}></div>
    </div>
  </div>
{/if}

<style>
  .disabled-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-8) var(--space-5);
    text-align: center;
  }

  .disabled-icon {
    color: var(--color-text-muted);
    margin-bottom: var(--space-4);
    opacity: 0.5;
  }

  .disabled-title {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-2);
  }

  .disabled-text {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    max-width: 400px;
    margin-bottom: var(--space-6);
  }

  .disabled-steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    text-align: left;
  }

  .step {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
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
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }

  .step-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .step-text code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: var(--color-bg-elevated);
    padding: 0.1rem var(--space-1-5);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
  }

  .browser-viewer {
    display: flex;
    flex-direction: column;
    height: calc(100vh - var(--header-height) - var(--space-10));
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1-5) var(--space-3);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-2-5);
    flex-shrink: 0;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    position: relative;
  }

  .conn-status {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: var(--space-1) var(--space-1-5);
    border-radius: var(--radius-sm);
    transition: background var(--transition-fast);
  }

  .conn-status:hover {
    background: var(--color-bg-hover);
  }

  .conn-info-popover {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    background: color-mix(in srgb, var(--color-bg-deep) 92%, transparent);
    backdrop-filter: blur(8px);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-2-5) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    z-index: 20;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  }

  .conn-info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
  }

  .conn-info-key {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .conn-info-val {
    color: var(--color-text-secondary);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
  }

  .conn-dot {
    width: var(--dot-size);
    height: var(--dot-size);
    border-radius: 50%;
    flex-shrink: 0;
    transition: background var(--transition-normal), box-shadow var(--transition-normal);
  }

  .conn-connecting {
    background: var(--color-warning);
    box-shadow: 0 0 4px var(--color-warning);
    animation: pulse 1.2s ease-in-out infinite;
  }

  .conn-on {
    background: var(--color-success);
    box-shadow: 0 0 4px var(--color-success);
  }

  .conn-off {
    background: var(--color-error);
    box-shadow: 0 0 4px var(--color-error);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .toolbar-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .toolbar-sep {
    width: 1px;
    height: 14px;
    background: var(--color-border);
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-family: var(--font-sans);
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .toolbar-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-border-subtle);
  }

  .toolbar-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .toolbar-btn.toolbar-btn-active {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .toolbar-btn.toolbar-btn-danger:hover {
    color: var(--color-error);
    border-color: var(--color-error);
  }

  .clipboard-popover {
    position: absolute;
    top: var(--space-2-5);
    right: var(--space-2-5);
    width: 280px;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    z-index: 10;
    box-shadow: var(--shadow-card);
  }

  .clipboard-label {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .clipboard-textarea {
    width: 100%;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-2);
    resize: vertical;
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .clipboard-textarea:focus {
    border-color: var(--color-accent);
  }

  .vnc-container {
    flex: 1;
    position: relative;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-bg-deep);
  }

  .vnc-canvas {
    width: 100%;
    height: 100%;
  }

  .vnc-canvas :global(div) {
    background: var(--color-bg-deep) !important;
  }

  .vnc-hidden {
    visibility: hidden;
  }

  .error-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-surface);
    gap: var(--space-2);
    z-index: 1;
  }

  .error-text {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .error-hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--space-1-5);
  }
</style>

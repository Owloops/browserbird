<script lang="ts">
  import type { StatusResponse } from './lib/types.ts';
  import {
    getPageFromHash,
    checkAuthRequired,
    verifyToken,
    getAuthToken,
    setAuthToken,
    clearAuthToken,
    setUnauthorizedCallback,
    api,
  } from './lib/api.ts';
  import { connectSSE, disconnectSSE, isSSEConnected } from './lib/sse.ts';
  import Sidebar from './components/Sidebar.svelte';
  import Toast from './components/Toast.svelte';
  import Dashboard from './pages/Dashboard.svelte';
  import Sessions from './pages/Sessions.svelte';
  import Jobs from './pages/Jobs.svelte';
  import Birds from './pages/Cron.svelte';
  import Browser from './pages/Browser.svelte';
  import Settings from './pages/Settings.svelte';
  import SessionDetail from './pages/SessionDetail.svelte';

  const PAGE_TITLES: Record<string, string> = {
    dashboard: 'Dashboard',
    sessions: 'Sessions',
    'session-detail': 'Session Detail',
    jobs: 'Jobs',
    birds: 'Birds',
    browser: 'Browser',
    settings: 'Settings',
  };

  let currentPage = $state(getPageFromHash());
  let authenticated = $state(false);
  let authChecking = $state(true);
  let status: StatusResponse | null = $state(null);
  let connectionState: 'connected' | 'disconnected' | 'connecting' = $state('connecting');

  let loginToken = $state('');
  let loginError = $state('');

  const pageTitle = $derived(PAGE_TITLES[currentPage] ?? 'Dashboard');

  setUnauthorizedCallback(() => {
    authenticated = false;
  });

  $effect(() => {
    const handler = () => {
      currentPage = getPageFromHash();
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  });

  $effect(() => {
    void checkAuthRequired().then(async (required) => {
      if (!required) {
        authenticated = true;
      } else if (getAuthToken()) {
        authenticated = await verifyToken();
      }
      authChecking = false;
    });
  });

  $effect(() => {
    if (!authenticated) return;

    connectSSE(
      (data) => {
        status = data;
        connectionState = 'connected';
      },
      (state) => {
        connectionState = state;
      },
    );

    const healthCheck = setInterval(() => {
      if (isSSEConnected()) return;
      void api<StatusResponse>('/api/status')
        .then(() => {
          connectionState = 'connected';
          connectSSE(
            (data) => {
              status = data;
              connectionState = 'connected';
            },
            (state) => {
              connectionState = state;
            },
          );
        })
        .catch(() => {
          connectionState = 'disconnected';
        });
    }, 30_000);

    return () => {
      disconnectSSE();
      clearInterval(healthCheck);
    };
  });

  async function handleLogin(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const token = loginToken.trim();
    if (!token) return;

    setAuthToken(token);
    try {
      await api<{ valid: boolean }>('/api/auth/verify', { method: 'POST' });
      loginError = '';
      loginToken = '';
      authenticated = true;
    } catch {
      clearAuthToken();
      loginError = 'Invalid token';
    }
  }
</script>

<Toast />

{#if authChecking}
  <div class="loading">Loading...</div>
{:else if !authenticated}
  <div class="login-overlay">
    <div class="login-card">
      <div class="login-brand">
        <img src="/logo.svg" alt="BrowserBird" class="login-logo" />
      </div>
      <form onsubmit={handleLogin}>
        <label class="form-label">
          Auth Token
          <input
            type="password"
            class="form-input"
            placeholder="Enter auth token"
            autocomplete="current-password"
            bind:value={loginToken}
          />
        </label>
        {#if loginError}
          <div class="login-error">{loginError}</div>
        {/if}
        <button type="submit" class="btn btn-primary login-submit">Authenticate</button>
      </form>
    </div>
  </div>
{:else}
  <div class="app">
    <Sidebar {currentPage} />
    <main class="content">
      <div class="content-header">
        <h1 class="page-title">{pageTitle}</h1>
        <div class="header-right">
          <span
            class="slack-status"
            class:slack-on={status?.slack.connected}
            class:slack-off={!status?.slack.connected}
            title="Slack: {status?.slack.connected ? 'connected' : 'disconnected'}"
          ></span>
        </div>
      </div>
      <div class="content-body">
        {#if currentPage === 'sessions'}
          <Sessions />
        {:else if currentPage === 'session-detail'}
          <SessionDetail />
        {:else if currentPage === 'jobs'}
          <Jobs sseJobs={status?.jobs ?? null} />
        {:else if currentPage === 'birds'}
          <Birds />
        {:else if currentPage === 'browser'}
          <Browser {status} />
        {:else if currentPage === 'settings'}
          <Settings {status} />
        {:else}
          <Dashboard {status} />
        {/if}
      </div>
    </main>
  </div>
{/if}

<style>
  .app {
    display: flex;
    min-height: 100vh;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .content-header {
    height: 56px;
    padding: 0 1.25rem;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .page-title {
    font-size: 1.067rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: -0.01em;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .slack-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .slack-on {
    background: var(--color-success);
    box-shadow: 0 0 4px var(--color-success);
  }

  .slack-off {
    background: var(--color-error);
    box-shadow: 0 0 4px var(--color-error);
  }

  .content-body {
    flex: 1;
    padding: 1.25rem;
    overflow-y: auto;
  }

  .login-overlay {
    position: fixed;
    inset: 0;
    background: var(--color-bg-deep);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .login-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: 2rem 1.75rem;
    width: 100%;
    max-width: 320px;
  }

  .login-brand {
    text-align: center;
    margin-bottom: 1.75rem;
  }

  .login-brand :global(.login-logo) {
    height: 40px;
    width: auto;
  }

  .login-error {
    color: var(--color-error);
    font-size: 0.769rem;
    margin-bottom: 0.625rem;
  }

  .login-submit {
    width: 100%;
    margin-top: 0.5rem;
  }

  @media (max-width: 768px) {
    .app {
      flex-direction: column;
    }
  }
</style>

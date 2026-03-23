<script lang="ts">
  import type { StatusResponse } from './lib/types.ts';
  import {
    getPageFromHash,
    getHashParams,
    checkAuth,
    verifyToken,
    getAuthToken,
    setAuthToken,
    clearAuthToken,
    setUnauthorizedCallback,
    login,
    setup,
    api,
  } from './lib/api.ts';
  import { connectSSE, disconnectSSE, isSSEConnected } from './lib/sse.ts';
  import { dispatchInvalidate } from './lib/invalidate.ts';
  import Sidebar from './components/Sidebar.svelte';
  import ServiceStatus from './components/ServiceStatus.svelte';
  import Toast from './components/Toast.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import MissionControl from './pages/MissionControl.svelte';
  import Sessions from './pages/Sessions.svelte';
  import Birds from './pages/Birds.svelte';
  import Computer from './pages/Computer.svelte';
  import Settings from './pages/Settings.svelte';
  import SessionDetail from './pages/SessionDetail.svelte';
  import Docs from './pages/Docs.svelte';
  import DocDetail from './pages/DocDetail.svelte';
  import Onboarding from './pages/Onboarding.svelte';

  const PAGE_TITLES: Record<string, string> = {
    status: 'Mission Control',
    sessions: 'Sessions',
    'session-detail': 'Session Detail',
    docs: 'Docs',
    'doc-detail': 'Doc Detail',
    birds: 'Birds',
    computer: 'Computer',
    settings: 'Settings',
  };

  type AuthState = 'checking' | 'setup' | 'login' | 'onboarding' | 'authenticated';

  let currentPage = $state(getPageFromHash());
  let authState: AuthState = $state('checking');
  let status: StatusResponse | null = $state(null);
  let connectionState: 'connected' | 'disconnected' | 'connecting' = $state('connecting');
  let sidebarCollapsed = $state(localStorage.getItem('sidebar-collapsed') === 'true');

  let mobileNavOpen = $state(false);
  let loginEmail = $state('');
  let loginPassword = $state('');
  let loginError = $state('');
  let setupEmail = $state('');
  let setupPassword = $state('');
  let setupConfirmPassword = $state('');
  let setupError = $state('');

  const pageTitle = $derived(PAGE_TITLES[currentPage] ?? 'Mission Control');

  $effect(() => {
    document.title = `${pageTitle} - BrowserBird`;
  });

  function toggleSidebar(): void {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed));
  }

  setUnauthorizedCallback(() => {
    authState = 'login';
  });

  $effect(() => {
    const handler = () => {
      currentPage = getPageFromHash();
      mobileNavOpen = false;
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  });

  $effect(() => {
    if (currentPage !== 'flights') return;
    const birdUid = getHashParams().get('birdUid');
    window.location.hash = birdUid ? `#/birds?expand=${birdUid}` : '#/birds';
  });

  $effect(() => {
    void checkAuth().then(async (result) => {
      if (result.setupRequired) {
        authState = 'setup';
      } else if (!result.authRequired) {
        authState = 'authenticated';
      } else if (getAuthToken()) {
        const valid = await verifyToken();
        if (!valid) {
          authState = 'login';
        } else if (result.onboardingRequired) {
          authState = 'onboarding';
        } else {
          authState = 'authenticated';
        }
      } else {
        authState = result.onboardingRequired ? 'login' : 'login';
      }
    });
  });

  $effect(() => {
    if (authState !== 'authenticated') return;

    connectSSE(
      (data) => {
        status = data;
        connectionState = 'connected';
      },
      (e) => dispatchInvalidate(e),
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
            (e) => dispatchInvalidate(e),
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

  function handleSignOut(): void {
    clearAuthToken();
    authState = 'login';
  }

  async function handleLogin(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const email = loginEmail.trim();
    const password = loginPassword;
    if (!email || !password) return;

    try {
      const result = await login(email, password);
      setAuthToken(result.token);
      loginError = '';
      loginEmail = '';
      loginPassword = '';
      authState = 'authenticated';
    } catch (err) {
      loginError = (err as Error).message;
    }
  }

  async function handleSetup(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const email = setupEmail.trim();
    const password = setupPassword;
    const confirm = setupConfirmPassword;
    if (!email || !password) return;

    if (password !== confirm) {
      setupError = 'Passwords do not match';
      return;
    }
    if (password.length < 8) {
      setupError = 'Password must be at least 8 characters';
      return;
    }

    try {
      const result = await setup(email, password);
      setAuthToken(result.token);
      setupError = '';
      setupEmail = '';
      setupPassword = '';
      setupConfirmPassword = '';
      const authCheck = await checkAuth();
      authState = authCheck.onboardingRequired ? 'onboarding' : 'authenticated';
    } catch (err) {
      setupError = (err as Error).message;
    }
  }
</script>

<Toast />
<ConfirmDialog />

{#if authState === 'checking'}
  <div class="loading">Loading...</div>
{:else if authState === 'setup'}
  <div class="login-overlay">
    <div class="login-card">
      <div class="login-brand">
        <img src="/logo.svg" alt="BrowserBird" class="login-logo" />
      </div>
      <h2 class="login-heading">Create your account</h2>
      <form onsubmit={handleSetup}>
        <label class="form-label">
          Email
          <input
            type="email"
            class="form-input"
            placeholder="you@example.com"
            autocomplete="email"
            bind:value={setupEmail}
          />
        </label>
        <label class="form-label">
          Password
          <input
            type="password"
            class="form-input"
            placeholder="At least 8 characters"
            autocomplete="new-password"
            bind:value={setupPassword}
          />
        </label>
        <label class="form-label">
          Confirm Password
          <input
            type="password"
            class="form-input"
            placeholder="Repeat password"
            autocomplete="new-password"
            bind:value={setupConfirmPassword}
          />
        </label>
        {#if setupError}
          <div class="login-error">{setupError}</div>
        {/if}
        <button type="submit" class="btn btn-primary login-submit">Create Account</button>
      </form>
    </div>
  </div>
{:else if authState === 'login'}
  <div class="login-overlay">
    <div class="login-card">
      <div class="login-brand">
        <img src="/logo.svg" alt="BrowserBird" class="login-logo" />
      </div>
      <form onsubmit={handleLogin}>
        <label class="form-label">
          Email
          <input
            type="email"
            class="form-input"
            placeholder="you@example.com"
            autocomplete="email"
            bind:value={loginEmail}
          />
        </label>
        <label class="form-label">
          Password
          <input
            type="password"
            class="form-input"
            placeholder="Enter password"
            autocomplete="current-password"
            bind:value={loginPassword}
          />
        </label>
        {#if loginError}
          <div class="login-error">{loginError}</div>
        {/if}
        <button type="submit" class="btn btn-primary login-submit">Sign In</button>
      </form>
    </div>
  </div>
{:else if authState === 'onboarding'}
  <Onboarding
    oncomplete={() => {
      authState = 'authenticated';
    }}
  />
{:else}
  <div class="app">
    <Sidebar
      {currentPage}
      collapsed={sidebarCollapsed}
      mobileOpen={mobileNavOpen}
      ontoggle={toggleSidebar}
      onmobileclose={() => {
        mobileNavOpen = false;
      }}
      onsignout={handleSignOut}
    />
    <main class="content">
      <div class="content-header">
        <button
          class="hamburger"
          onclick={() => {
            mobileNavOpen = true;
          }}
          aria-label="Open navigation"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <h1 class="page-title">{pageTitle}</h1>
        <div class="header-right">
          <ServiceStatus {status} />
        </div>
      </div>
      <div class="content-body">
        {#if currentPage === 'sessions'}
          <Sessions />
        {:else if currentPage === 'session-detail'}
          <SessionDetail />
        {:else if currentPage === 'docs'}
          <Docs />
        {:else if currentPage === 'doc-detail'}
          <DocDetail />
        {:else if currentPage === 'birds'}
          <Birds />
        {:else if currentPage === 'computer'}
          <Computer {status} />
        {:else if currentPage === 'settings'}
          <Settings {status} />
        {:else}
          <MissionControl {status} />
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
    height: var(--header-height);
    padding: 0 var(--space-5);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .page-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text-secondary);
    letter-spacing: -0.01em;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .hamburger {
    display: none;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    transition: color var(--transition-fast);
  }

  .hamburger:hover {
    color: var(--color-text-primary);
  }

  .content-body {
    flex: 1;
    padding: var(--space-6);
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
    background: color-mix(in srgb, var(--color-bg-surface) 92%, transparent);
    backdrop-filter: blur(16px);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-8) var(--space-6);
    width: 100%;
    max-width: 320px;
    box-shadow: var(--shadow-elevated);
  }

  .login-brand {
    text-align: center;
    margin-bottom: var(--space-6);
  }

  .login-brand :global(.login-logo) {
    height: 44px;
    width: auto;
  }

  .login-heading {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-align: center;
    margin-bottom: var(--space-4);
  }

  .login-error {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin-bottom: var(--space-2-5);
  }

  .login-submit {
    width: 100%;
    margin-top: var(--space-2);
  }

  @media (max-width: 768px) {
    .hamburger {
      display: flex;
    }

    .content-header {
      height: 44px;
      padding: 0 var(--space-3);
    }

    .content-body {
      padding: var(--space-3);
    }

    .page-title {
      font-size: var(--text-base);
    }
  }

  @media (max-width: 480px) {
    .content-header {
      padding: 0 var(--space-2);
    }

    .content-body {
      padding: var(--space-2);
    }
  }
</style>

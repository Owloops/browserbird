<script lang="ts">
  interface Props {
    currentPage: string;
  }

  const NAV_ITEMS = [
    { page: 'dashboard', icon: '◉', label: 'Dashboard' },
    { page: 'sessions', icon: '⟡', label: 'Sessions' },
    { page: 'jobs', icon: '⟳', label: 'Jobs' },
    { page: 'birds', icon: '⏲', label: 'Birds' },
    { page: 'logs', icon: '▤', label: 'Logs' },
    { page: 'browser', icon: '◧', label: 'Browser' },
    { page: 'settings', icon: '⚙', label: 'Settings' },
  ] as const;

  let { currentPage }: Props = $props();
</script>

<nav class="sidebar">
  <div class="sidebar-brand">
    <img src="/logo.svg" alt="BrowserBird" class="brand-logo" />
  </div>
  <div class="sidebar-nav">
    {#each NAV_ITEMS as item}
      <a
        class="nav-item"
        class:active={currentPage === item.page}
        href="#/{item.page === 'dashboard' ? '' : item.page}"
      >
        <span class="nav-icon">{item.icon}</span>
        <span class="nav-label">{item.label}</span>
      </a>
    {/each}
  </div>
</nav>

<style>
  .sidebar {
    width: var(--sidebar-width);
    background: var(--color-bg-surface);
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .sidebar-brand {
    padding: 0.625rem 0.875rem;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
  }

  .brand-logo {
    height: 26px;
    width: auto;
  }

  .sidebar-nav {
    flex: 1;
    padding: 0.375rem 0;
    overflow-y: auto;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.533rem;
    padding: 0.467rem 0.933rem;
    color: var(--color-text-muted);
    text-decoration: none;
    font-size: 0.933rem;
    font-weight: 500;
    transition: color var(--transition-fast);
  }

  .nav-item:hover {
    color: var(--color-text-secondary);
  }

  .nav-item.active {
    color: var(--color-text-primary);
  }

  .nav-icon {
    font-size: 0.933rem;
    width: 1.133rem;
    text-align: center;
    flex-shrink: 0;
    opacity: 0.5;
  }

  .nav-item.active .nav-icon {
    opacity: 1;
    color: var(--color-accent);
  }

  @media (max-width: 768px) {
    .sidebar {
      width: 100%;
      border-right: none;
      border-bottom: 1px solid var(--color-border);
    }

    .sidebar-nav {
      display: flex;
      overflow-x: auto;
      padding: 0;
    }

    .nav-item {
      white-space: nowrap;
      padding: 0.4rem 0.625rem;
    }

    .nav-icon {
      display: none;
    }
  }
</style>

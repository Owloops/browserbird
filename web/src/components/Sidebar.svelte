<script lang="ts">
  interface Props {
    currentPage: string;
  }

  const NAV_ITEMS = [
    {
      page: 'status',
      label: 'Status',
      svg: `<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>`,
    },
    {
      page: 'sessions',
      label: 'Sessions',
      svg: `<path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/>`,
    },
    {
      page: 'birds',
      label: 'Birds',
      svg: `<path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/>`,
    },
    {
      page: 'flights',
      label: 'Flights',
      svg: `<path d="M3 3h18"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M3 21h18"/>`,
    },
    {
      page: 'browser',
      label: 'Browser',
      svg: `<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>`,
    },
    {
      page: 'settings',
      label: 'Settings',
      svg: `<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>`,
    },
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
        href="#/{item.page === 'status' ? '' : item.page}"
      >
        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html item.svg}</svg>
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
    height: var(--header-height);
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .brand-logo {
    height: 28px;
    width: auto;
  }

  .sidebar-nav {
    flex: 1;
    padding: var(--space-1-5) 0;
    overflow-y: auto;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    color: var(--color-text-muted);
    text-decoration: none;
    font-size: var(--text-base);
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
    width: 1.125rem;
    height: 1.125rem;
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
      padding: var(--space-1-5) var(--space-2-5);
    }

    .nav-icon {
      display: none;
    }
  }
</style>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ColumnDef } from '../lib/types.ts';

  interface Props {
    columns: ColumnDef[];
    emptyMessage?: string;
    isEmpty: boolean;
    children: Snippet;
    toolbar?: Snippet;
    page?: number;
    totalPages?: number;
    totalItems?: number;
    sort?: string;
    search?: string;
    searchPlaceholder?: string;
    fetching?: boolean;
    onPageChange?: (page: number) => void;
    onSortChange?: (key: string) => void;
    onSearchChange?: (search: string) => void;
  }

  let {
    columns,
    emptyMessage = 'No data',
    isEmpty,
    children,
    toolbar,
    page,
    totalPages,
    totalItems,
    sort,
    search,
    searchPlaceholder = 'Search...',
    fetching,
    onPageChange,
    onSortChange,
    onSearchChange,
  }: Props = $props();

  const hasPagination = $derived(page != null && totalPages != null && onPageChange != null);

  function sortDirection(key: string): 'asc' | 'desc' | null {
    if (!sort) return null;
    if (sort === `-${key}`) return 'desc';
    if (sort === key) return 'asc';
    return null;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function handleSearchInput(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => onSearchChange?.(value), 300);
  }
</script>

{#if toolbar || onSearchChange}
  <div class="table-toolbar">
    {#if toolbar}
      {@render toolbar()}
    {/if}
    {#if onSearchChange}
      <input
        type="search"
        class="search-input"
        placeholder={searchPlaceholder}
        value={search ?? ''}
        oninput={handleSearchInput}
      />
    {/if}
  </div>
{/if}

<div class="table-card" class:table-fetching={fetching}>
  <div class="table-scroll">
    <table class="table">
      <thead>
        <tr>
          {#each columns as col (col.key)}
            <th class={col.class ?? ''}>
              {#if col.sortable && onSortChange}
                {@const dir = sortDirection(col.key)}
                <button class="sort-btn" onclick={() => onSortChange(col.key)}>
                  {col.label}
                  {#if dir === 'asc'}
                    <svg class="sort-icon" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                      <path
                        d="M1 5L5 1L9 5"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  {:else if dir === 'desc'}
                    <svg class="sort-icon" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                      <path
                        d="M1 1L5 5L9 1"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  {/if}
                </button>
              {:else}
                {col.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if isEmpty}
          <tr>
            <td colspan={columns.length} class="empty-state">{emptyMessage}</td>
          </tr>
        {:else}
          {@render children()}
        {/if}
      </tbody>
    </table>
  </div>
  {#if hasPagination && totalPages! > 1}
    <div class="pagination">
      <button class="pg-btn" disabled={page === 1} onclick={() => onPageChange!(page! - 1)}>
        <svg class="pg-icon" viewBox="0 0 6 10" fill="none" aria-hidden="true">
          <path
            d="M5 1L1 5L5 9"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        Prev
      </button>
      <span class="pg-info">
        Page {page} of {totalPages}{totalItems != null ? ` · ${totalItems} total` : ''}
      </span>
      <button
        class="pg-btn"
        disabled={page === totalPages}
        onclick={() => onPageChange!(page! + 1)}
      >
        Next
        <svg class="pg-icon" viewBox="0 0 6 10" fill="none" aria-hidden="true">
          <path
            d="M1 1L5 5L1 9"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .table-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    align-items: center;
  }

  .search-input {
    margin-left: auto;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-2);
    min-width: 180px;
    transition: border-color var(--transition-fast);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--color-accent-dim);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.15);
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .table-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    transition: opacity var(--transition-normal);
  }

  .table-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .table-fetching {
    opacity: 0.5;
    pointer-events: none;
  }

  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-base);
    table-layout: auto;
  }

  .table :global(th),
  .table :global(td) {
    text-align: left;
    padding: var(--space-2-5) var(--space-4);
    border-bottom: 1px solid rgba(35, 42, 53, 0.6);
  }

  .table :global(th) {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: transparent;
    white-space: nowrap;
    border-bottom: 1px solid var(--color-border);
  }

  .table :global(td) {
    color: var(--color-text-secondary);
  }

  .table :global(tr:last-child td) {
    border-bottom: none;
  }

  .table :global(tr:hover td) {
    background: var(--color-bg-elevated);
  }

  .sort-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0;
    white-space: nowrap;
  }

  .sort-btn:hover {
    color: var(--color-text-primary);
  }

  .sort-icon {
    width: 10px;
    height: 6px;
    margin-left: 4px;
    vertical-align: middle;
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-border);
  }

  .pg-btn {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .pg-btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent-dim);
  }

  .pg-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .pg-icon {
    width: 6px;
    height: 10px;
    vertical-align: middle;
  }

  .pg-info {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .empty-state {
    text-align: center;
    color: var(--color-text-muted);
    padding: var(--space-6) var(--space-4);
  }

  @media (max-width: 768px) {
    .table {
      font-size: var(--text-sm);
    }

    .table :global(th),
    .table :global(td) {
      padding: var(--space-2) var(--space-2-5);
    }

    .search-input {
      min-width: 0;
      flex: 1;
    }

    .pg-info {
      font-size: 0.65rem;
    }
  }

  @media (max-width: 480px) {
    .table :global(th),
    .table :global(td) {
      padding: var(--space-1-5) var(--space-2);
    }

    .table-toolbar {
      gap: var(--space-1-5);
    }
  }
</style>

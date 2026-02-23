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
    onPageChange,
    onSortChange,
    onSearchChange,
  }: Props = $props();

  const hasPagination = $derived(page != null && totalPages != null && onPageChange != null);

  function sortIndicator(key: string): string {
    if (!sort) return '';
    if (sort === `-${key}`) return ' \u2193';
    if (sort === key) return ' \u2191';
    return '';
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

<div class="table-wrap">
  <table class="table">
    <thead>
      <tr>
        {#each columns as col (col.key)}
          <th class={col.class ?? ''}>
            {#if col.sortable && onSortChange}
              <button class="sort-btn" onclick={() => onSortChange(col.key)}
                >{col.label}{sortIndicator(col.key)}</button
              >
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
  {#if hasPagination && totalPages! > 1}
    <div class="pagination">
      <button class="pg-btn" disabled={page === 1} onclick={() => onPageChange!(page! - 1)}
        >← Prev</button
      >
      <span class="pg-info">
        Page {page} of {totalPages}{totalItems != null ? ` · ${totalItems} total` : ''}
      </span>
      <button class="pg-btn" disabled={page === totalPages} onclick={() => onPageChange!(page! + 1)}
        >Next →</button
      >
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
  }

  .search-input::placeholder {
    color: var(--color-text-muted);
  }

  .table-wrap {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
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
    border-bottom: 1px solid var(--color-border);
  }

  .table :global(th) {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--color-bg-elevated);
    white-space: nowrap;
  }

  .table :global(td) {
    color: var(--color-text-secondary);
  }

  .table :global(tr:last-child td) {
    border-bottom: none;
  }

  .table :global(tr:hover td) {
    background: var(--color-bg-hover);
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

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
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
</style>

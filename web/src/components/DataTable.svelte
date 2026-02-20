<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    columns: string[];
    emptyMessage?: string;
    isEmpty: boolean;
    children: Snippet;
    page?: number;
    totalPages?: number;
    totalItems?: number;
    onPageChange?: (page: number) => void;
  }

  let {
    columns,
    emptyMessage = 'No data',
    isEmpty,
    children,
    page,
    totalPages,
    totalItems,
    onPageChange,
  }: Props = $props();

  const hasPagination = $derived(page != null && totalPages != null && onPageChange != null);
</script>

<div class="table-wrap">
  <table class="table">
    <thead>
      <tr>
        {#each columns as col}
          <th>{col}</th>
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
  .table-wrap {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.933rem;
    table-layout: auto;
  }

  .table :global(th),
  .table :global(td) {
    text-align: left;
    padding: 0.6rem 0.867rem;
    border-bottom: 1px solid var(--color-border);
  }

  .table :global(th) {
    font-size: 0.733rem;
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

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
  }

  .pg-btn {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: 0.8rem;
    font-family: var(--font-mono);
    padding: 0.333rem 0.6rem;
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
    font-size: 0.733rem;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }
</style>

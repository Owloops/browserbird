<script lang="ts">
  import type { ColumnDef, DocInfo } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { createDataTable } from '../lib/data-table.svelte.ts';
  import { createBindingData } from '../lib/binding-data.svelte.ts';
  import { formatAge, timeStamp } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { showConfirm } from '../lib/confirm.svelte.ts';
  import DataTable from '../components/DataTable.svelte';
  import BindingEditor from '../components/BindingEditor.svelte';

  const columns: ColumnDef[] = [
    { key: 'title', label: 'Title', sortable: true },
    { key: 'bindings', label: 'Bindings' },
    { key: 'created_at', label: 'Created', sortable: true },
    { key: 'actions', label: '' },
  ];

  let lastUpdated = $state(timeStamp());

  const table = createDataTable<DocInfo>({
    endpoint: '/api/docs',
    columns,
    defaultSort: 'created_at',
    invalidateOn: 'docs',
    onResponse: () => {
      lastUpdated = timeStamp();
    },
  });

  const bd = createBindingData();

  let creating = $state(false);

  async function createNew(): Promise<void> {
    creating = true;
    try {
      const doc = await api<DocInfo>('/api/docs', {
        method: 'POST',
        body: { title: 'Untitled' },
      });
      window.location.hash = `#/doc-detail?id=${doc.uid}`;
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      creating = false;
    }
  }

  async function deleteDocAction(uid: string, title: string): Promise<void> {
    if (!(await showConfirm(`Delete "${title}"?`))) return;
    try {
      await api(`/api/docs/${uid}`, { method: 'DELETE' });
      showToast('Doc deleted', 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function handleRowClick(e: MouseEvent, doc: DocInfo): void {
    if ((e.target as HTMLElement).closest('.actions-cell, .bindings-cell')) return;
    window.location.hash = `#/doc-detail?id=${doc.uid}`;
  }
</script>

{#if table.loading}
  <div class="loading">Loading...</div>
{:else}
  <DataTable
    {columns}
    isEmpty={table.items.length === 0}
    emptyMessage="No docs yet"
    fetching={table.fetching}
    page={table.page}
    totalPages={table.totalPages}
    totalItems={table.totalItems}
    sort={table.sort}
    search={table.search}
    searchPlaceholder="Search docs..."
    onPageChange={table.setPage}
    onSortChange={table.setSort}
    onSearchChange={table.setSearch}
  >
    {#snippet toolbar()}
      <button class="btn btn-primary btn-sm" disabled={creating} onclick={createNew}
        >{creating ? 'Creating...' : 'New Doc'}</button
      >
      <div class="filter-spacer"></div>
      <span class="last-updated">Updated {lastUpdated}</span>
    {/snippet}
    {#snippet cards()}
      {#each table.items as doc (doc.uid)}
        <button class="item-card" onclick={(e) => handleRowClick(e, doc)}>
          <div class="item-card-header">
            <span class="item-card-id">{doc.title}</span>
            <span class="item-card-meta">{formatAge(doc.created_at)}</span>
          </div>
          <div class="item-card-fields">
            <div class="item-card-field">
              <span class="item-card-label">Bindings</span>
              <span>{doc.bindings.length}</span>
            </div>
          </div>
        </button>
      {/each}
    {/snippet}
    {#each table.items as doc (doc.uid)}
      <tr class="doc-row" onclick={(e) => handleRowClick(e, doc)}>
        <td class="doc-title-cell">{doc.title}</td>
        <td>
          <BindingEditor
            bindings={doc.bindings}
            endpoint={`/api/docs/${doc.uid}/bindings`}
            channels={bd.channels}
            birds={bd.birds}
          />
        </td>
        <td class="age-cell">{formatAge(doc.created_at)}</td>
        <td>
          <div class="actions-cell">
            <button
              class="btn btn-danger btn-sm"
              onclick={() => deleteDocAction(doc.uid, doc.title)}>Delete</button
            >
          </div>
        </td>
      </tr>
    {/each}
  </DataTable>
{/if}

<style>
  .doc-row {
    cursor: pointer;
  }

  .doc-title-cell {
    font-weight: 500;
    white-space: nowrap;
  }

  .age-cell {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    white-space: nowrap;
  }

  .actions-cell {
    display: flex;
    gap: var(--space-1);
  }
</style>

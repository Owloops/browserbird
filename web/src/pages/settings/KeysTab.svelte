<script lang="ts">
  import type {
    ColumnDef,
    KeyInfo,
    CronJobRow,
    PaginatedResult,
    ConfigResponse,
  } from '../../lib/types.ts';
  import { api } from '../../lib/api.ts';
  import { createDataTable } from '../../lib/data-table.svelte.ts';
  import { formatAge, timeStamp } from '../../lib/format.ts';
  import { showToast } from '../../lib/toast.svelte.ts';
  import { showConfirm } from '../../lib/confirm.svelte.ts';
  import DataTable from '../../components/DataTable.svelte';
  import BindingEditor from '../../components/BindingEditor.svelte';

  type EditableField = 'value' | 'description';

  interface EditingCell {
    uid: string;
    field: EditableField;
    value: string;
    original: string;
  }

  interface Props {
    config: ConfigResponse | null;
  }

  let { config }: Props = $props();

  let birds: CronJobRow[] = $state([]);
  let lastUpdated = $state(timeStamp());

  const columns: ColumnDef[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'hint', label: 'Value' },
    { key: 'description', label: 'Description' },
    { key: 'bindings', label: 'Bindings' },
    { key: 'created_at', label: 'Created', sortable: true },
    { key: 'actions', label: '' },
  ];

  const table = createDataTable<KeyInfo>({
    endpoint: '/api/keys',
    columns,
    defaultSort: 'name',
    invalidateOn: 'keys',
    onResponse() {
      lastUpdated = timeStamp();
    },
  });

  const channels: string[] = $derived(config?.slack.channels ?? []);

  let showForm = $state(false);
  let formName = $state('');
  let formValue = $state('');
  let formDescription = $state('');
  let submitting = $state(false);

  let editing: EditingCell | null = $state(null);
  let saving = $state(false);

  $effect(() => {
    const ac = new AbortController();
    api<PaginatedResult<CronJobRow>>('/api/birds?perPage=100')
      .then((data) => {
        if (!ac.signal.aborted) {
          birds = data.items.filter((b) => !b.name.startsWith('__bb_'));
        }
      })
      .catch(() => {});
    return () => ac.abort();
  });

  function openCreate(): void {
    formName = '';
    formValue = '';
    formDescription = '';
    showForm = true;
  }

  function closeForm(): void {
    showForm = false;
  }

  async function submitCreate(): Promise<void> {
    const name = formName.trim().toUpperCase();
    if (!name || !formValue) return;
    submitting = true;
    try {
      await api('/api/keys', {
        method: 'POST',
        body: {
          name,
          value: formValue,
          description: formDescription.trim() || undefined,
        },
      });
      showToast('Key created', 'success');
      closeForm();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      submitting = false;
    }
  }

  function startCellEdit(key: KeyInfo, field: EditableField): void {
    const value = field === 'value' ? '' : (key[field] ?? '');
    const original = field === 'value' ? '' : (key[field] ?? '');
    editing = { uid: key.uid, field, value, original };
  }

  function cancelCellEdit(): void {
    editing = null;
    saving = false;
  }

  async function saveCellEdit(): Promise<void> {
    if (editing == null) return;
    const trimmed = editing.value.trim();
    if (editing.field === 'value' && !trimmed) return;
    if (editing.field !== 'value' && trimmed === editing.original.trim()) {
      editing = null;
      return;
    }
    saving = true;
    try {
      await api(`/api/keys/${editing.uid}`, {
        method: 'PATCH',
        body: { [editing.field]: trimmed },
      });
      showToast(`Updated ${editing.field}`, 'success');
      editing = null;
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      saving = false;
    }
  }

  function handleCellKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      cancelCellEdit();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveCellEdit();
    }
  }

  function isEditingCell(uid: string, field: EditableField): boolean {
    return editing != null && editing.uid === uid && editing.field === field;
  }

  async function handleDelete(key: KeyInfo): Promise<void> {
    const confirmed = await showConfirm(`Delete key "${key.name}"?`);
    if (!confirmed) return;
    try {
      await api(`/api/keys/${key.uid}`, { method: 'DELETE' });
      showToast('Key deleted', 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }
</script>

{#if showForm}
  <div class="create-form">
    <div class="form-title">New Key</div>
    <div class="form-row">
      <label class="form-label">
        Name
        <input class="form-input" type="text" placeholder="GITHUB_TOKEN" bind:value={formName} />
      </label>
      <label class="form-label">
        Value
        <input
          class="form-input"
          type="password"
          placeholder="secret value"
          bind:value={formValue}
        />
      </label>
      <label class="form-label">
        Description
        <input class="form-input" type="text" placeholder="Optional" bind:value={formDescription} />
      </label>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary btn-sm" disabled={submitting} onclick={submitCreate}
        >{submitting ? 'Saving...' : 'Create'}</button
      >
      <button class="btn btn-outline btn-sm" onclick={closeForm}>Cancel</button>
    </div>
  </div>
{/if}

{#snippet cellActions()}
  <div class="cell-edit-actions">
    <button
      class="cell-btn cell-btn-save"
      title="Save"
      disabled={saving || (editing?.field === 'value' && !editing?.value.trim())}
      onclick={(e) => {
        e.stopPropagation();
        saveCellEdit();
      }}
    >
      {#if saving}
        <span class="cell-btn-label">...</span>
      {:else}
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
          ><path
            d="M3 8.5l3.5 3.5L13 4.5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          /></svg
        >
      {/if}
    </button>
    <button
      class="cell-btn cell-btn-cancel"
      title="Cancel"
      onclick={(e) => {
        e.stopPropagation();
        cancelCellEdit();
      }}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
        ><path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        /></svg
      >
    </button>
  </div>
{/snippet}

{#if table.loading}
  <div class="loading">Loading...</div>
{:else}
  <DataTable
    {columns}
    isEmpty={table.items.length === 0}
    emptyMessage="No keys stored"
    fetching={table.fetching}
    page={table.page}
    totalPages={table.totalPages}
    totalItems={table.totalItems}
    sort={table.sort}
    search={table.search}
    searchPlaceholder="Search keys..."
    onPageChange={table.setPage}
    onSortChange={table.setSort}
    onSearchChange={table.setSearch}
  >
    {#snippet toolbar()}
      <button
        class="btn btn-primary btn-sm"
        onclick={() => {
          if (showForm) closeForm();
          else openCreate();
        }}>{showForm ? 'Cancel' : 'Add Key'}</button
      >
      <div class="filter-spacer"></div>
      <span class="last-updated">Updated {lastUpdated}</span>
    {/snippet}
    {#each table.items as key (key.uid)}
      <tr>
        <td class="mono key-name-cell">{key.name}</td>
        <td class="cell-editable" onclick={() => startCellEdit(key, 'value')}>
          <span class="mono cell-text" class:cell-text-hidden={isEditingCell(key.uid, 'value')}
            >{key.hint}</span
          >
          {#if isEditingCell(key.uid, 'value')}
            <div class="cell-edit-overlay">
              <input
                class="cell-input mono"
                type="password"
                placeholder="new value"
                bind:value={editing!.value}
                onkeydown={handleCellKeydown}
              />
              {@render cellActions()}
            </div>
          {/if}
        </td>
        <td class="cell-editable" onclick={() => startCellEdit(key, 'description')}>
          <span
            class="cell-text desc-text"
            class:cell-text-hidden={isEditingCell(key.uid, 'description')}
            >{key.description ?? '-'}</span
          >
          {#if isEditingCell(key.uid, 'description')}
            <div class="cell-edit-overlay">
              <input
                class="cell-input"
                type="text"
                bind:value={editing!.value}
                onkeydown={handleCellKeydown}
              />
              {@render cellActions()}
            </div>
          {/if}
        </td>
        <td>
          <BindingEditor
            bindings={key.bindings}
            endpoint={`/api/keys/${key.uid}/bindings`}
            {channels}
            {birds}
            emptyLabel=""
          />
        </td>
        <td class="age-cell">{formatAge(key.created_at)}</td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-danger btn-sm" onclick={() => handleDelete(key)}>Delete</button>
          </div>
        </td>
      </tr>
    {/each}
  </DataTable>
{/if}

<style>
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: var(--space-2);
  }

  .form-actions {
    display: flex;
    gap: var(--space-1-5);
    justify-content: flex-end;
  }

  .key-name-cell {
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

  .desc-text {
    display: block;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-secondary);
  }

  @media (max-width: 768px) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }
</style>

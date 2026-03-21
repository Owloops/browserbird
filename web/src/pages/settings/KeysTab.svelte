<script lang="ts">
  import type {
    ColumnDef,
    KeyInfo,
    KeyBinding,
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

  let addingBindingUid: string | null = $state(null);
  let bindingType: 'channel' | 'bird' = $state('channel');
  let bindingTargetId = $state('');
  let bindingSaving = $state(false);

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

  function toggleAddBinding(keyUid: string): void {
    if (addingBindingUid === keyUid) {
      addingBindingUid = null;
      return;
    }
    addingBindingUid = keyUid;
    bindingType = 'channel';
    bindingTargetId = '';
  }

  async function addBinding(): Promise<void> {
    if (!addingBindingUid || !bindingTargetId) return;
    bindingSaving = true;
    try {
      const key = table.items.find((k) => k.uid === addingBindingUid);
      const existing = key?.bindings ?? [];
      const already = existing.some(
        (b) => b.targetType === bindingType && b.targetId === bindingTargetId,
      );
      if (already) {
        showToast('Binding already exists', 'info');
        bindingSaving = false;
        return;
      }
      const updated = [...existing, { targetType: bindingType, targetId: bindingTargetId }];
      await api(`/api/keys/${addingBindingUid}/bindings`, { method: 'PUT', body: updated });
      showToast('Binding added', 'success');
      bindingTargetId = '';
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      bindingSaving = false;
    }
  }

  async function removeBinding(keyUid: string, binding: KeyBinding): Promise<void> {
    const key = table.items.find((k) => k.uid === keyUid);
    if (!key) return;
    const updated = key.bindings.filter(
      (b) => !(b.targetType === binding.targetType && b.targetId === binding.targetId),
    );
    try {
      await api(`/api/keys/${keyUid}/bindings`, { method: 'PUT', body: updated });
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function bindingLabel(b: KeyBinding): string {
    if (b.targetType === 'bird') {
      const bird = birds.find((br) => br.uid === b.targetId);
      return bird ? bird.name : b.targetId.slice(0, 10);
    }
    return b.targetId;
  }

  const bindingTargets = $derived.by(() => {
    if (bindingType === 'channel') {
      return channels.map((ch) => ({ value: ch, label: ch }));
    }
    return birds.map((b) => ({ value: b.uid, label: b.name }));
  });
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
          <div class="bindings-cell">
            {#each key.bindings as binding}
              <span class="chip">
                <span class="chip-type">{binding.targetType}</span>
                <span class="chip-label">{bindingLabel(binding)}</span>
                <button
                  class="chip-remove"
                  onclick={() => removeBinding(key.uid, binding)}
                  aria-label={`Remove ${bindingLabel(binding)}`}
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
              </span>
            {/each}
            <button
              class="chip chip-add"
              class:chip-add-active={addingBindingUid === key.uid}
              onclick={(e) => {
                e.stopPropagation();
                toggleAddBinding(key.uid);
              }}
            >
              {#if addingBindingUid === key.uid}
                <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
                  ><path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  /></svg
                >
              {:else}
                <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"
                  ><path
                    d="M8 3v10M3 8h10"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  /></svg
                >
              {/if}
            </button>
            {#if addingBindingUid === key.uid}
              <div class="binding-picker">
                <select
                  class="inline-select"
                  bind:value={bindingType}
                  onchange={() => {
                    bindingTargetId = '';
                  }}
                >
                  <option value="channel">Channel</option>
                  <option value="bird">Bird</option>
                </select>
                <select class="inline-select binding-target" bind:value={bindingTargetId}>
                  <option value="">Select {bindingType}...</option>
                  {#each bindingTargets as t}
                    <option value={t.value}>{t.label}</option>
                  {/each}
                </select>
                <button
                  class="btn btn-primary btn-sm"
                  disabled={bindingSaving || !bindingTargetId}
                  onclick={addBinding}>Add</button
                >
              </div>
            {/if}
          </div>
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

  .bindings-cell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    padding: 3px var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    transition: border-color var(--transition-fast);
  }

  .chip-type {
    color: var(--color-text-muted);
  }

  .chip-label {
    color: var(--color-text-secondary);
  }

  .chip-remove {
    display: flex;
    align-items: center;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: color var(--transition-fast);
  }

  .chip-remove svg {
    width: 10px;
    height: 10px;
  }

  .chip-remove:hover {
    color: var(--color-error);
  }

  .chip-add {
    cursor: pointer;
    padding: 3px var(--space-1-5);
    border-style: dashed;
    color: var(--color-text-muted);
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast),
      background var(--transition-fast);
  }

  .chip-add svg {
    width: 12px;
    height: 12px;
  }

  .chip-add:hover,
  .chip-add-active {
    color: var(--color-accent);
    border-color: var(--color-accent-dim);
    background: var(--color-accent-bg);
  }

  .binding-picker {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
  }

  .binding-target {
    min-width: 140px;
  }

  @media (max-width: 768px) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }
</style>

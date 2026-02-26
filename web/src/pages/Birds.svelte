<script lang="ts">
  import type { ColumnDef, CronJobRow, CreateCronRequest } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { createDataTable } from '../lib/data-table.svelte.ts';
  import { formatAge, timeStamp, shortUid } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { showConfirm } from '../lib/confirm.svelte.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';
  import Toggle from '../components/Toggle.svelte';

  type EditableField = 'schedule' | 'prompt' | 'agent_id' | 'target_channel_id';

  interface EditingCell {
    uid: string;
    field: EditableField;
    value: string;
    original: string;
  }

  const columns: ColumnDef[] = [
    { key: 'uid', label: 'ID', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'schedule', label: 'Schedule', sortable: true },
    { key: 'prompt', label: 'Prompt' },
    { key: 'agent_id', label: 'Agent', sortable: true },
    { key: 'target_channel_id', label: 'Channel' },
    { key: 'enabled', label: 'Enabled', sortable: true },
    { key: 'last_run', label: 'Last Run', sortable: true },
    { key: 'actions', label: 'Actions' },
  ];

  let lastUpdated = $state(timeStamp());

  const table = createDataTable<CronJobRow>({
    endpoint: '/api/birds',
    columns,
    defaultSort: 'created_at',
    invalidateOn: 'birds',
    onResponse: () => {
      lastUpdated = timeStamp();
    },
  });

  let showForm = $state(false);
  let formSchedule = $state('');
  let formPrompt = $state('');
  let formChannel = $state('');
  let formAgent = $state('');
  let submitting = $state(false);

  let editing: EditingCell | null = $state(null);
  let saving = $state(false);

  async function toggleCron(uid: string, currentlyEnabled: boolean): Promise<void> {
    const action = currentlyEnabled ? 'disable' : 'enable';
    try {
      await api(`/api/birds/${uid}/${action}`, { method: 'PATCH' });
      showToast(`Bird ${shortUid(uid)} ${action}d`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function openCreate(): void {
    formSchedule = '';
    formPrompt = '';
    formChannel = '';
    formAgent = '';
    showForm = true;
  }

  function closeForm(): void {
    showForm = false;
  }

  async function submitCreate(): Promise<void> {
    if (!formSchedule.trim() || !formPrompt.trim()) {
      showToast('Schedule and prompt are required', 'error');
      return;
    }
    submitting = true;
    try {
      const body: CreateCronRequest = {
        schedule: formSchedule.trim(),
        prompt: formPrompt.trim(),
      };
      if (formChannel.trim()) body.channel = formChannel.trim();
      if (formAgent.trim()) body.agent = formAgent.trim();
      await api('/api/birds', { method: 'POST', body });
      showToast('Bird created', 'success');
      closeForm();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      submitting = false;
    }
  }

  function startCellEdit(job: CronJobRow, field: EditableField): void {
    if (job.name.startsWith('__bb_')) return;
    const value = job[field] ?? '';
    editing = { uid: job.uid, field, value, original: value };
  }

  function cancelCellEdit(): void {
    editing = null;
  }

  async function saveCellEdit(): Promise<void> {
    if (editing == null) return;
    const trimmed = editing.value.trim();
    if (trimmed === editing.original.trim()) {
      editing = null;
      return;
    }
    const clearable = editing.field === 'target_channel_id';
    if (!trimmed && !clearable) {
      showToast('Value cannot be empty', 'error');
      return;
    }
    saving = true;
    const fieldMap: Record<EditableField, string> = {
      schedule: 'schedule',
      prompt: 'prompt',
      agent_id: 'agent',
      target_channel_id: 'channel',
    };
    try {
      await api(`/api/birds/${editing.uid}`, {
        method: 'PATCH',
        body: { [fieldMap[editing.field]]: trimmed || null },
      });
      showToast(`Updated ${editing.field.replace('_', ' ')}`, 'success');
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
    } else if (e.key === 'Enter') {
      const isPrompt = editing?.field === 'prompt';
      if (isPrompt ? e.metaKey : !e.shiftKey) {
        e.preventDefault();
        saveCellEdit();
      }
    }
  }

  function isEditingCell(uid: string, field: EditableField): boolean {
    return editing != null && editing.uid === uid && editing.field === field;
  }

  async function runCron(uid: string): Promise<void> {
    try {
      const result = await api<{ success: boolean; jobId: number }>(`/api/birds/${uid}/fly`, {
        method: 'POST',
      });
      showToast(`Bird ${shortUid(uid)} sent on a flight (job #${result.jobId})`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function deleteCron(uid: string, name: string): Promise<void> {
    if (!(await showConfirm(`Delete bird "${name}"? This will also remove all flight history.`)))
      return;
    try {
      await api(`/api/birds/${uid}`, { method: 'DELETE' });
      showToast(`Bird ${shortUid(uid)} deleted`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }
</script>

{#if table.loading}
  <div class="loading">Loading...</div>
{:else}
  {#if showForm}
    <div class="create-form">
      <div class="form-title">New Bird</div>
      <div class="form-row">
        <label class="form-label">
          Schedule
          <input
            class="form-input"
            type="text"
            placeholder="*/30 * * * *"
            bind:value={formSchedule}
          />
        </label>
        <label class="form-label">
          Channel ID
          <input class="form-input" type="text" placeholder="Optional" bind:value={formChannel} />
        </label>
        <label class="form-label">
          Agent ID
          <input class="form-input" type="text" placeholder="default" bind:value={formAgent} />
        </label>
      </div>
      <label class="form-label">
        Prompt
        <textarea
          class="form-textarea"
          placeholder="What should the agent do?"
          bind:value={formPrompt}
        ></textarea>
      </label>
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
        disabled={saving}
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

  <DataTable
    {columns}
    isEmpty={table.items.length === 0}
    emptyMessage="No birds configured"
    fetching={table.fetching}
    page={table.page}
    totalPages={table.totalPages}
    totalItems={table.totalItems}
    sort={table.sort}
    search={table.search}
    searchPlaceholder="Search birds..."
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
        }}>{showForm ? 'Cancel' : 'Add Bird'}</button
      >
      <div class="filter-spacer"></div>
      <span class="last-updated">Updated {lastUpdated}</span>
    {/snippet}
    {#each table.items as j (j.uid)}
      {@const isSystem = j.name.startsWith('__bb_')}
      <tr>
        <td class="mono">{shortUid(j.uid)}</td>
        <td>{j.name}</td>
        <td class:cell-editable={!isSystem} onclick={() => startCellEdit(j, 'schedule')}>
          <span class="mono cell-text" class:cell-text-hidden={isEditingCell(j.uid, 'schedule')}
            >{j.schedule}</span
          >
          {#if isEditingCell(j.uid, 'schedule')}
            <div class="cell-edit-overlay">
              <input
                class="cell-input mono"
                type="text"
                bind:value={editing!.value}
                onkeydown={handleCellKeydown}
              />
              {@render cellActions()}
            </div>
          {/if}
        </td>
        <td class:cell-editable={!isSystem} onclick={() => startCellEdit(j, 'prompt')}>
          <span
            class="cell-text prompt-text"
            class:cell-text-hidden={isEditingCell(j.uid, 'prompt')}
            title={j.prompt}>{j.prompt.slice(0, 60)}{j.prompt.length > 60 ? '...' : ''}</span
          >
          {#if isEditingCell(j.uid, 'prompt')}
            <div class="cell-edit-overlay">
              <textarea
                class="cell-input cell-textarea"
                bind:value={editing!.value}
                onkeydown={handleCellKeydown}
              ></textarea>
              {@render cellActions()}
            </div>
          {/if}
        </td>
        <td class:cell-editable={!isSystem} onclick={() => startCellEdit(j, 'agent_id')}>
          <span class="cell-text" class:cell-text-hidden={isEditingCell(j.uid, 'agent_id')}
            >{j.agent_id}</span
          >
          {#if isEditingCell(j.uid, 'agent_id')}
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
        <td class:cell-editable={!isSystem} onclick={() => startCellEdit(j, 'target_channel_id')}>
          <span
            class="mono cell-text"
            class:cell-text-hidden={isEditingCell(j.uid, 'target_channel_id')}
            >{j.target_channel_id ?? '-'}</span
          >
          {#if isEditingCell(j.uid, 'target_channel_id')}
            <div class="cell-edit-overlay">
              <input
                class="cell-input mono"
                type="text"
                placeholder="Channel ID"
                bind:value={editing!.value}
                onkeydown={handleCellKeydown}
              />
              {@render cellActions()}
            </div>
          {/if}
        </td>
        <td>
          <Toggle active={!!j.enabled} onToggle={() => toggleCron(j.uid, !!j.enabled)} />
        </td>
        <td class="last-run-cell">
          {#if j.last_run}
            <span class="last-run-age">{formatAge(j.last_run)}</span>
            {#if j.last_status}
              <Badge status={j.last_status} />
            {/if}
          {:else}
            -
          {/if}
        </td>
        <td>
          <div class="actions-cell">
            <a class="btn btn-outline btn-sm" href="#/flights?birdUid={j.uid}">Flights</a>
            <button class="btn btn-outline btn-sm" onclick={() => runCron(j.uid)}>Fly</button>
            {#if !isSystem}
              <button class="btn btn-danger btn-sm" onclick={() => deleteCron(j.uid, j.name)}
                >Delete</button
              >
            {/if}
          </div>
        </td>
      </tr>
    {/each}
  </DataTable>
{/if}

<style>
  .filter-spacer {
    flex: 1;
  }

  .last-updated {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .create-form {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    box-shadow: var(--shadow-sm);
  }

  .form-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

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

  .last-run-cell {
    white-space: nowrap;
  }

  .last-run-age {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-right: var(--space-1-5);
  }

  .actions-cell {
    display: flex;
    gap: var(--space-1);
  }

  .cell-editable {
    cursor: pointer;
    position: relative;
  }

  .cell-editable .cell-text {
    text-decoration: underline;
    text-decoration-style: dashed;
    text-decoration-color: rgba(255, 255, 255, 0.15);
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
  }

  .cell-editable:hover .cell-text {
    color: var(--color-text-primary);
    text-decoration-style: solid;
    text-decoration-color: var(--color-accent-dim);
  }

  .cell-text {
    transition: color 0.12s ease;
    white-space: nowrap;
  }

  .cell-text-hidden {
    visibility: hidden;
  }

  .cell-edit-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    min-width: 200px;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: var(--color-bg-surface);
    border-radius: var(--radius-sm);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    z-index: 2;
  }

  .cell-edit-overlay:has(.cell-textarea) {
    bottom: auto;
    min-height: 100%;
    height: 5rem;
    align-items: flex-start;
    padding-top: var(--space-1-5);
    padding-bottom: var(--space-1-5);
  }

  .cell-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-1-5) var(--space-2);
    background: var(--color-bg-deep);
    border: 1px solid var(--color-accent-dim);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.1);
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .cell-input.mono {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .cell-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.18);
  }

  .cell-textarea {
    resize: none;
    line-height: 1.5;
    overflow-y: auto;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .cell-edit-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    padding-top: var(--space-1);
  }

  .cell-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: 0;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }

  .cell-btn svg {
    width: 14px;
    height: 14px;
  }

  .cell-btn-save {
    background: var(--color-accent-dim);
    color: var(--color-text-primary);
  }

  .cell-btn-save:hover {
    background: var(--color-accent);
  }

  .cell-btn-save:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .cell-btn-cancel {
    background: transparent;
    color: var(--color-text-muted);
  }

  .cell-btn-cancel:hover {
    background: var(--color-bg-elevated);
    color: var(--color-text-secondary);
  }

  .cell-btn-label {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }

  .prompt-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 768px) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }
</style>

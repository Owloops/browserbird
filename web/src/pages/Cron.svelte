<script lang="ts">
  import type { PaginatedResult, CronJobRow, CreateCronRequest } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge, timeStamp } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import DataTable from '../components/DataTable.svelte';
  import Toggle from '../components/Toggle.svelte';

  const PER_PAGE = 20;

  let cronJobs: CronJobRow[] = $state([]);
  let totalPages = $state(1);
  let totalItems = $state(0);
  let page = $state(1);
  let loading = $state(true);
  let showSystem = $state(false);
  let lastUpdated = $state(timeStamp());

  let showForm = $state(false);
  let editingId: number | null = $state(null);
  let formSchedule = $state('');
  let formPrompt = $state('');
  let formChannel = $state('');
  let formAgent = $state('');
  let submitting = $state(false);

  async function fetchCron(p: number, system: boolean, signal: AbortSignal): Promise<void> {
    try {
      const params = new URLSearchParams();
      params.set('page', String(p));
      params.set('perPage', String(PER_PAGE));
      if (system) params.set('system', 'true');
      const data = await api<PaginatedResult<CronJobRow>>(`/api/birds?${params.toString()}`);
      if (signal.aborted) return;
      cronJobs = data.items;
      totalPages = data.totalPages;
      totalItems = data.totalItems;
      lastUpdated = timeStamp();
    } catch {
      /* connection check handles display */
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  $effect(() => {
    const p = page;
    const system = showSystem;
    const ac = new AbortController();
    fetchCron(p, system, ac.signal);
    const timer = setInterval(() => fetchCron(p, system, ac.signal), 15_000);
    return () => {
      ac.abort();
      clearInterval(timer);
    };
  });

  function refresh(): Promise<void> {
    return fetchCron(page, showSystem, new AbortController().signal);
  }

  async function toggleCron(id: number, currentlyEnabled: boolean): Promise<void> {
    const action = currentlyEnabled ? 'disable' : 'enable';
    try {
      await api(`/api/birds/${id}/${action}`, { method: 'PATCH' });
      showToast(`Bird #${id} ${action}d`, 'success');
      await refresh();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function resetForm(): void {
    formSchedule = '';
    formPrompt = '';
    formChannel = '';
    formAgent = '';
    editingId = null;
  }

  function openCreate(): void {
    resetForm();
    showForm = true;
  }

  function openEdit(job: CronJobRow): void {
    editingId = job.id;
    formSchedule = job.schedule;
    formPrompt = job.prompt;
    formChannel = job.target_channel_id ?? '';
    formAgent = job.agent_id;
    showForm = true;
  }

  function closeForm(): void {
    showForm = false;
    resetForm();
  }

  async function submitForm(): Promise<void> {
    if (!formSchedule.trim() || !formPrompt.trim()) {
      showToast('Schedule and prompt are required', 'error');
      return;
    }
    submitting = true;
    try {
      if (editingId != null) {
        await api(`/api/birds/${editingId}`, {
          method: 'PATCH',
          body: {
            schedule: formSchedule.trim(),
            prompt: formPrompt.trim(),
            channel: formChannel.trim() || null,
            agent: formAgent.trim() || undefined,
          },
        });
        showToast(`Bird #${editingId} updated`, 'success');
      } else {
        const body: CreateCronRequest = {
          schedule: formSchedule.trim(),
          prompt: formPrompt.trim(),
        };
        if (formChannel.trim()) body.channel = formChannel.trim();
        if (formAgent.trim()) body.agent = formAgent.trim();
        await api('/api/birds', { method: 'POST', body });
        showToast('Bird created', 'success');
      }
      closeForm();
      await refresh();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      submitting = false;
    }
  }

  async function runCron(id: number): Promise<void> {
    try {
      const result = await api<{ success: boolean; jobId: number }>(`/api/birds/${id}/fly`, {
        method: 'POST',
      });
      showToast(`Bird #${id} sent on a flight (job #${result.jobId})`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function deleteCron(id: number): Promise<void> {
    try {
      await api(`/api/birds/${id}`, { method: 'DELETE' });
      showToast(`Bird #${id} deleted`, 'success');
      await refresh();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <div class="filter-bar">
    <button
      class="btn btn-primary btn-sm"
      onclick={() => {
        if (showForm) closeForm();
        else openCreate();
      }}>{showForm && editingId == null ? 'Cancel' : 'Add Bird'}</button
    >
    <div class="system-toggle">
      <Toggle
        active={showSystem}
        onToggle={() => {
          showSystem = !showSystem;
          page = 1;
        }}
      />
      <span>System jobs</span>
    </div>
    <div class="filter-spacer"></div>
    <span class="last-updated">Updated {lastUpdated}</span>
  </div>

  {#if showForm}
    <div class="create-form">
      <div class="form-title">{editingId != null ? `Edit Bird #${editingId}` : 'New Bird'}</div>
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
        <button class="btn btn-primary btn-sm" disabled={submitting} onclick={submitForm}
          >{submitting ? 'Saving...' : editingId != null ? 'Update' : 'Create'}</button
        >
        <button class="btn btn-outline btn-sm" onclick={closeForm}>Cancel</button>
      </div>
    </div>
  {/if}

  <DataTable
    columns={['ID', 'Name', 'Schedule', 'Prompt', 'Agent', 'Enabled', 'Last Run', 'Actions']}
    isEmpty={cronJobs.length === 0}
    emptyMessage="No birds configured"
    {page}
    {totalPages}
    {totalItems}
    onPageChange={(p) => {
      page = p;
    }}
  >
    {#each cronJobs as j (j.id)}
      <tr>
        <td class="mono">{j.id}</td>
        <td>{j.name}</td>
        <td class="mono">{j.schedule}</td>
        <td>{j.prompt.slice(0, 60)}{j.prompt.length > 60 ? '...' : ''}</td>
        <td>{j.agent_id}</td>
        <td>
          <Toggle active={!!j.enabled} onToggle={() => toggleCron(j.id, !!j.enabled)} />
        </td>
        <td>
          {#if j.last_run}
            {formatAge(j.last_run)} ({j.last_status ?? '—'})
          {:else}
            —
          {/if}
        </td>
        <td>
          <div class="actions-cell">
            <a class="btn btn-outline btn-sm" href="#/jobs?cronJobId={j.id}">History</a>
            <button class="btn btn-outline btn-sm" onclick={() => openEdit(j)}>Edit</button>
            <button class="btn btn-outline btn-sm" onclick={() => runCron(j.id)}>Fly</button>
            <button class="btn btn-danger btn-sm" onclick={() => deleteCron(j.id)}>Delete</button>
          </div>
        </td>
      </tr>
    {/each}
  </DataTable>
{/if}

<style>
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    align-items: center;
  }

  .system-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.769rem;
    color: var(--color-text-secondary);
    user-select: none;
  }

  .filter-spacer {
    flex: 1;
  }

  .last-updated {
    font-size: 0.733rem;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .create-form {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0.75rem;
    margin-bottom: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
  }

  .form-actions {
    display: flex;
    gap: 0.375rem;
    justify-content: flex-end;
  }

  .actions-cell {
    display: flex;
    gap: 0.25rem;
  }

  .actions-cell a {
    text-decoration: none;
  }

  @media (max-width: 768px) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }
</style>

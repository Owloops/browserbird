<script lang="ts">
  import type { PaginatedResult, CronJobRow, CreateCronRequest, FlightRow } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge, timeStamp } from '../lib/format.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { showConfirm } from '../lib/confirm.svelte.ts';
  import { onInvalidate } from '../lib/invalidate.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';
  import Toggle from '../components/Toggle.svelte';

  const PER_PAGE = 20;

  let cronJobs: CronJobRow[] = $state([]);
  let totalPages = $state(1);
  let totalItems = $state(0);
  let page = $state(1);
  let loading = $state(true);
  let showSystem = $state(false);
  let lastUpdated = $state(timeStamp());

  let expandedId: number | null = $state(null);
  let flightHistory: Record<number, FlightRow[]> = $state({});
  let flightLoading: Record<number, boolean> = $state({});

  async function toggleHistory(id: number): Promise<void> {
    if (expandedId === id) {
      expandedId = null;
      return;
    }
    expandedId = id;
    if (flightHistory[id]) return;
    flightLoading = { ...flightLoading, [id]: true };
    try {
      const result = await api<PaginatedResult<FlightRow>>(`/api/birds/${id}/flights?perPage=10`);
      flightHistory = { ...flightHistory, [id]: result.items };
    } catch {
      flightHistory = { ...flightHistory, [id]: [] };
    } finally {
      flightLoading = { ...flightLoading, [id]: false };
    }
  }

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
    const unsub = onInvalidate((e) => {
      if (e.resource !== 'birds') return;
      fetchCron(p, system, ac.signal);
      if (e.cronJobId != null && expandedId === e.cronJobId) {
        const { [e.cronJobId]: _, ...rest } = flightHistory;
        flightHistory = rest;
      }
    });
    return () => {
      ac.abort();
      unsub();
    };
  });

  function refresh(): Promise<void> {
    flightHistory = {};
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
      const { [id]: _, ...rest } = flightHistory;
      flightHistory = rest;
      showToast(`Bird #${id} sent on a flight (job #${result.jobId})`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function flightDuration(startedAt: string, finishedAt: string | null): string {
    if (!finishedAt) return '—';
    const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 0) return '—';
    const secs = Math.round(ms / 1000);
    return secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  }

  async function deleteCron(id: number, name: string): Promise<void> {
    if (!(await showConfirm(`Delete bird "${name}"? This will also remove all flight history.`)))
      return;
    try {
      await api(`/api/birds/${id}`, { method: 'DELETE' });
      showToast(`Bird #${id} deleted`, 'success');
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
      <span>System birds</span>
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
        <td class="last-run-cell">
          {#if j.last_run}
            <span class="last-run-age">{formatAge(j.last_run)}</span>
            {#if j.last_status}
              <Badge status={j.last_status} />
            {/if}
          {:else}
            —
          {/if}
        </td>
        <td>
          <div class="actions-cell">
            <button
              class="btn btn-outline btn-sm"
              class:btn-active={expandedId === j.id}
              onclick={() => toggleHistory(j.id)}>Flights</button
            >
            <button class="btn btn-outline btn-sm" onclick={() => openEdit(j)}>Edit</button>
            <button class="btn btn-outline btn-sm" onclick={() => runCron(j.id)}>Fly</button>
            <button class="btn btn-danger btn-sm" onclick={() => deleteCron(j.id, j.name)}
              >Delete</button
            >
          </div>
        </td>
      </tr>
      {#if expandedId === j.id}
        <tr class="flight-history-row">
          <td colspan="8">
            {#if flightLoading[j.id]}
              <div class="flight-loading">Loading flights...</div>
            {:else if !flightHistory[j.id]?.length}
              <div class="flight-empty">No flight history</div>
            {:else}
              <table class="flight-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Started</th>
                    <th>Error / Result</th>
                  </tr>
                </thead>
                <tbody>
                  {#each flightHistory[j.id] as flight (flight.id)}
                    <tr>
                      <td class="mono">#{flight.id}</td>
                      <td><Badge status={flight.status} /></td>
                      <td class="mono">{flightDuration(flight.started_at, flight.finished_at)}</td>
                      <td>{formatAge(flight.started_at)}</td>
                      <td class="flight-summary">{flight.error ?? flight.result ?? '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </td>
        </tr>
      {/if}
    {/each}
  </DataTable>
{/if}

<style>
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    align-items: center;
  }

  .system-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    user-select: none;
  }

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
    padding: var(--space-3);
    margin-bottom: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
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

  .btn-active {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
  }

  .flight-history-row td {
    padding: 0;
    background: var(--color-bg-deep);
  }

  .flight-loading,
  .flight-empty {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .flight-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .flight-table th {
    padding: var(--space-1-5) var(--space-3);
    text-align: left;
    font-weight: 600;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--color-border);
  }

  .flight-table td {
    padding: var(--space-1-5) var(--space-3);
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--color-border);
  }

  .flight-table tr:last-child td {
    border-bottom: none;
  }

  .flight-summary {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-muted);
  }

  @media (max-width: 768px) {
    .form-row {
      grid-template-columns: 1fr;
    }
  }
</style>

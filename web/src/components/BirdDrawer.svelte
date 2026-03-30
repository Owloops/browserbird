<script lang="ts">
  import type { CronJobRow, FlightRow, PaginatedResult } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { shortUid } from '../lib/format.ts';
  import { onInvalidate } from '../lib/invalidate.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { showConfirm, confirmStore } from '../lib/confirm.svelte.ts';
  import { tick } from 'svelte';
  import Badge from './Badge.svelte';
  import Toggle from './Toggle.svelte';
  import InlineEdit from './InlineEdit.svelte';
  import FlightCard from './FlightCard.svelte';

  type EditableField = 'name' | 'schedule' | 'prompt' | 'agent_id' | 'target_channel_id';

  interface Props {
    bird: CronJobRow;
    onclose: () => void;
  }

  let { bird, onclose }: Props = $props();

  let flights: FlightRow[] = $state([]);
  let flightsLoading = $state(true);
  let flightsPage = $state(1);
  let flightsTotalPages = $state(1);
  let flightsTotalItems = $state(0);
  let statusFilter: '' | 'success' | 'error' | 'running' = $state('');
  let flightSearch = $state('');
  let expandedFlightUid: string | null = $state(null);
  let visible = $state(false);

  let enabledOverride: boolean | null = $state(null);
  const localEnabled = $derived(enabledOverride ?? !!bird.enabled);

  $effect(() => {
    bird.enabled;
    enabledOverride = null;
  });

  let editingField: EditableField | null = $state(null);
  let editingValue = $state('');
  let editingSaving = $state(false);

  let searchDebounce: ReturnType<typeof setTimeout> | undefined;
  let debouncedSearch = $state('');

  const isSystem = $derived(bird.name.startsWith('__bb_'));

  tick().then(() => {
    visible = true;
  });

  function close(): void {
    visible = false;
    setTimeout(onclose, 200);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (confirmStore.pending) return;
      if (editingField) {
        cancelEdit();
      } else {
        close();
      }
    }
  }

  function buildFlightsUrl(uid: string, page: number, filter: string, search: string): string {
    let url = `/api/flights?birdUid=${uid}&perPage=10&sort=-started_at&page=${page}`;
    if (filter) url += `&status=${filter}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    return url;
  }

  $effect(() => {
    const uid = bird.uid;
    const page = flightsPage;
    const filter = statusFilter;
    const search = debouncedSearch;
    const ac = new AbortController();

    flightsLoading = true;
    api<PaginatedResult<FlightRow>>(buildFlightsUrl(uid, page, filter, search))
      .then((res) => {
        if (ac.signal.aborted) return;
        flights = res.items;
        flightsTotalPages = res.totalPages;
        flightsTotalItems = res.totalItems;
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        flights = [];
        flightsTotalPages = 1;
        flightsTotalItems = 0;
      })
      .finally(() => {
        if (!ac.signal.aborted) flightsLoading = false;
      });

    return () => ac.abort();
  });

  $effect(() => {
    const uid = bird.uid;
    const unsub = onInvalidate((e) => {
      if (e.resource === 'birds') {
        const url = buildFlightsUrl(uid, flightsPage, statusFilter, debouncedSearch);
        api<PaginatedResult<FlightRow>>(url)
          .then((res) => {
            flights = res.items;
            flightsTotalPages = res.totalPages;
            flightsTotalItems = res.totalItems;
          })
          .catch(() => {});
      }
    });
    return unsub;
  });

  function setFilter(f: '' | 'success' | 'error' | 'running'): void {
    statusFilter = f;
    flightsPage = 1;
    expandedFlightUid = null;
  }

  function handleSearchInput(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    flightSearch = value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      debouncedSearch = value;
      flightsPage = 1;
      expandedFlightUid = null;
    }, 300);
  }

  async function toggleEnabled(): Promise<void> {
    const next = !localEnabled;
    enabledOverride = next;
    const action = next ? 'enable' : 'disable';
    try {
      await api(`/api/birds/${bird.uid}/${action}`, { method: 'PATCH' });
      showToast(`Bird ${shortUid(bird.uid)} ${action}d`, 'success');
    } catch (err) {
      enabledOverride = null;
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function startEdit(field: EditableField): void {
    if (isSystem) return;
    editingField = field;
    editingValue = bird[field] ?? '';
  }

  function cancelEdit(): void {
    editingField = null;
    editingValue = '';
  }

  async function saveEdit(): Promise<void> {
    if (!editingField) return;
    const trimmed = editingValue.trim();
    const original = (bird[editingField] ?? '').trim();
    if (trimmed === original) {
      cancelEdit();
      return;
    }
    const clearable = editingField === 'target_channel_id';
    if (!trimmed && !clearable) {
      showToast('Value cannot be empty', 'error');
      return;
    }
    editingSaving = true;
    const fieldMap: Record<EditableField, string> = {
      name: 'name',
      schedule: 'schedule',
      prompt: 'prompt',
      agent_id: 'agent',
      target_channel_id: 'channel',
    };
    try {
      await api(`/api/birds/${bird.uid}`, {
        method: 'PATCH',
        body: { [fieldMap[editingField]]: trimmed || null },
      });
      showToast(`Updated ${editingField.replace('_', ' ')}`, 'success');
      cancelEdit();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      editingSaving = false;
    }
  }

  async function flyBird(): Promise<void> {
    try {
      const result = await api<{ success: boolean; jobId: number }>(`/api/birds/${bird.uid}/fly`, {
        method: 'POST',
      });
      showToast(`Bird ${shortUid(bird.uid)} sent on a flight (job #${result.jobId})`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function deleteBird(): Promise<void> {
    if (
      !(await showConfirm(`Delete bird "${bird.name}"? This will also remove all flight history.`))
    )
      return;
    try {
      await api(`/api/birds/${bird.uid}`, { method: 'DELETE' });
      showToast(`Bird ${shortUid(bird.uid)} deleted`, 'success');
      close();
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function retryFlight(flight: FlightRow): Promise<void> {
    try {
      await api(`/api/birds/${flight.bird_uid}/fly`, { method: 'POST' });
      showToast(`Retrying ${flight.bird_name}`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay" class:visible>
  <button class="backdrop" onclick={close} aria-label="Close drawer"></button>
  <div class="drawer-panel">
    <div class="drawer-header">
      <div class="header-top">
        {#if editingField === 'name'}
          <InlineEdit
            bind:value={editingValue}
            saving={editingSaving}
            onsave={saveEdit}
            oncancel={cancelEdit}
          />
        {:else}
          <button class="bird-name" class:editable={!isSystem} onclick={() => startEdit('name')}>{bird.name}</button>
        {/if}
        <button class="close-btn" onclick={close} aria-label="Close">
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
      <div class="meta-row">
        {#if editingField === 'schedule'}
          <InlineEdit
            bind:value={editingValue}
            mono
            saving={editingSaving}
            onsave={saveEdit}
            oncancel={cancelEdit}
          />
        {:else}
          <button
            class="schedule-pill mono"
            class:editable={!isSystem}
            onclick={() => startEdit('schedule')}>{bird.schedule}</button
          >
        {/if}
        <div class="toggle-wrapper">
          <Toggle active={localEnabled} onToggle={toggleEnabled} />
        </div>
        {#if bird.last_status}
          <Badge status={bird.last_status} />
        {/if}
      </div>
    </div>

    <div class="drawer-body">
      <div class="config-section">
        <div class="config-grid">
          <div class="config-item">
            <span class="config-label">Agent</span>
            {#if editingField === 'agent_id'}
              <InlineEdit
                bind:value={editingValue}
                saving={editingSaving}
                onsave={saveEdit}
                oncancel={cancelEdit}
              />
            {:else}
              <button
                class="config-value"
                class:editable={!isSystem}
                onclick={() => startEdit('agent_id')}>{bird.agent_id}</button
              >
            {/if}
          </div>
          <div class="config-item">
            <span class="config-label">Channel</span>
            {#if editingField === 'target_channel_id'}
              <InlineEdit
                bind:value={editingValue}
                mono
                placeholder="Channel ID"
                saving={editingSaving}
                onsave={saveEdit}
                oncancel={cancelEdit}
              />
            {:else}
              <button
                class="config-value mono"
                class:editable={!isSystem}
                onclick={() => startEdit('target_channel_id')}
                >{bird.target_channel_id ?? 'default'}</button
              >
            {/if}
          </div>
        </div>
        <div class="prompt-block">
          <span class="config-label">Prompt</span>
          {#if editingField === 'prompt'}
            <InlineEdit
              bind:value={editingValue}
              mono
              multiline
              saving={editingSaving}
              onsave={saveEdit}
              oncancel={cancelEdit}
            />
          {:else}
            <button
              class="prompt-pre"
              class:editable={!isSystem}
              onclick={() => startEdit('prompt')}>{bird.prompt}</button
            >
          {/if}
        </div>
      </div>

      <div class="actions-row">
        <button class="btn btn-outline btn-sm" onclick={flyBird}>Fly</button>
        {#if !isSystem}
          <button class="btn btn-danger btn-sm" onclick={deleteBird}>Delete</button>
        {/if}
      </div>

      <div class="divider"></div>

      <div class="flights-section">
        <div class="flights-header">
          <span class="flights-title">Flight Log</span>
          {#if flightsTotalItems > 0}
            <span class="flights-count mono">{flightsTotalItems}</span>
          {/if}
        </div>

        <div class="filter-row">
          <button
            class="filter-chip"
            class:filter-all-active={statusFilter === ''}
            onclick={() => setFilter('')}>All</button
          >
          <button
            class="filter-chip"
            class:filter-success-active={statusFilter === 'success'}
            onclick={() => setFilter('success')}>Success</button
          >
          <button
            class="filter-chip"
            class:filter-error-active={statusFilter === 'error'}
            onclick={() => setFilter('error')}>Error</button
          >
          <button
            class="filter-chip"
            class:filter-running-active={statusFilter === 'running'}
            onclick={() => setFilter('running')}>Running</button
          >
          <input
            type="search"
            class="flight-search"
            placeholder="Search flights..."
            value={flightSearch}
            oninput={handleSearchInput}
          />
        </div>

        {#if flightsLoading}
          <div class="flights-empty">Loading flights...</div>
        {:else if flights.length === 0}
          <div class="flights-empty">
            {flightSearch || statusFilter ? 'No matching flights' : 'No flights yet'}
          </div>
        {:else}
          <div class="flight-list">
            {#each flights as flight (flight.uid)}
              <FlightCard
                {flight}
                expanded={expandedFlightUid === flight.uid}
                ontoggle={() => {
                  expandedFlightUid = expandedFlightUid === flight.uid ? null : flight.uid;
                }}
                onretry={() => retryFlight(flight)}
              />
            {/each}
          </div>

          {#if flightsTotalPages > 1}
            <div class="pagination">
              <button
                class="pg-btn"
                disabled={flightsPage === 1}
                onclick={() => {
                  flightsPage--;
                }}
              >
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
                {flightsPage} / {flightsTotalPages}
              </span>
              <button
                class="pg-btn"
                disabled={flightsPage === flightsTotalPages}
                onclick={() => {
                  flightsPage++;
                }}
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
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    pointer-events: none;
  }

  .overlay.visible {
    pointer-events: auto;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    border: none;
    cursor: default;
    opacity: 0;
    transition: opacity var(--transition-normal);
  }

  .visible .backdrop {
    opacity: 1;
  }

  .drawer-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: clamp(360px, 40vw, 640px);
    background: var(--color-bg-surface);
    box-shadow: var(--shadow-elevated);
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform var(--transition-normal);
  }

  .visible .drawer-panel {
    transform: translateX(0);
  }

  .drawer-header {
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }

  .bird-name {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--color-text-primary);
    background: none;
    border: none;
    padding: 0;
    cursor: default;
    text-align: left;
  }

  .bird-name.editable {
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .bird-name.editable:hover {
    color: var(--color-accent);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast),
      background var(--transition-fast);
  }

  .close-btn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-subtle);
    background: var(--color-bg-hover);
  }

  .close-btn svg {
    width: 14px;
    height: 14px;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .schedule-pill {
    font-size: var(--text-xs);
    padding: 2px var(--space-2);
    background: var(--color-accent-bg);
    color: var(--color-accent-glow);
    border-radius: var(--radius-full);
    border: none;
    cursor: default;
  }

  .editable {
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dashed;
    text-decoration-color: rgba(255, 255, 255, 0.12);
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
  }

  .editable:hover {
    text-decoration-style: solid;
    text-decoration-color: var(--color-accent-dim);
  }

  .toggle-wrapper {
    display: inline-flex;
  }

  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4) var(--space-5);
  }

  .config-section {
    margin-bottom: var(--space-3);
  }

  .config-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .config-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .config-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .config-value {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    font-family: inherit;
    cursor: default;
  }

  .config-value.editable:hover {
    color: var(--color-text-primary);
  }

  .prompt-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prompt-pre {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: var(--color-bg-deep);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 160px;
    overflow-y: auto;
    margin: 0;
    text-align: left;
    cursor: default;
  }

  .prompt-pre.editable:hover {
    border-color: var(--color-accent-dim);
    color: var(--color-text-primary);
  }

  .actions-row {
    display: flex;
    gap: var(--space-1-5);
    margin-bottom: var(--space-3);
  }

  .divider {
    border-top: 1px solid var(--color-border);
    margin-bottom: var(--space-3);
  }

  .flights-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .flights-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .flights-title {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .flights-count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: var(--color-bg-elevated);
    padding: 1px var(--space-1-5);
    border-radius: var(--radius-full);
  }

  .filter-row {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    align-items: center;
  }

  .filter-chip {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 3px var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
      color var(--transition-fast),
      background var(--transition-fast),
      border-color var(--transition-fast);
  }

  .filter-chip:hover {
    color: var(--color-text-secondary);
    border-color: var(--color-border-subtle);
  }

  .filter-all-active {
    background: var(--color-accent-bg);
    border-color: var(--color-accent-dim);
    color: var(--color-accent-glow);
  }

  .filter-success-active {
    background: var(--color-success-bg);
    border-color: var(--color-success);
    color: var(--color-success);
  }

  .filter-error-active {
    background: var(--color-error-bg);
    border-color: var(--color-error);
    color: var(--color-error);
  }

  .filter-running-active {
    background: var(--color-accent-bg);
    border-color: var(--color-accent);
    color: var(--color-accent-glow);
  }

  .flight-search {
    margin-left: auto;
    background: var(--color-bg-deep);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 3px var(--space-2);
    min-width: 0;
    width: 140px;
    transition: border-color var(--transition-fast);
  }

  .flight-search:focus {
    outline: none;
    border-color: var(--color-accent-dim);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.15);
  }

  .flight-search::placeholder {
    color: var(--color-text-muted);
  }

  .flights-empty {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: var(--space-3) 0;
  }

  .flight-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: var(--space-2);
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

  @media (max-width: 768px) {
    .drawer-panel {
      width: 100vw;
      max-width: none;
    }

    .drawer-header {
      padding: var(--space-3) var(--space-4);
    }

    .drawer-body {
      padding: var(--space-3) var(--space-4);
    }

    .flight-search {
      width: 100%;
      margin-left: 0;
    }
  }
</style>

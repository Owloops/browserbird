<script lang="ts">
  import type {
    StatusResponse,
    ConfigResponse,
    DoctorResponse,
    SecretsResponse,
    PaginatedResult,
    LogRow,
    JobStats,
    CronJobRow,
  } from '../lib/types.ts';
  import type { ConfigEditor } from './settings/types.ts';
  import { api } from '../lib/api.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { onInvalidate } from '../lib/invalidate.ts';
  import ConfigTab from './settings/ConfigTab.svelte';
  import DatabaseTab from './settings/DatabaseTab.svelte';

  interface Props {
    status: StatusResponse | null;
  }

  let { status }: Props = $props();

  let config: ConfigResponse | null = $state(null);
  let secrets: SecretsResponse | null = $state(null);
  let doctor: DoctorResponse | null = $state(null);
  let doctorLoading = $state(true);
  let recentErrors: LogRow[] = $state([]);
  let jobStats: JobStats | null = $state(null);
  let systemBirds: CronJobRow[] = $state([]);
  let loading = $state(true);
  let activeTab: 'config' | 'database' = $state('config');

  let editingField: string | null = $state(null);
  let editingSaving = $state(false);

  $effect(() => {
    const ac = new AbortController();
    Promise.all([
      api<ConfigResponse>('/api/config'),
      api<PaginatedResult<LogRow>>('/api/logs?level=error&perPage=10'),
      api<JobStats>('/api/jobs/stats'),
      api<PaginatedResult<CronJobRow>>('/api/birds?system=true&perPage=100'),
      api<SecretsResponse>('/api/secrets'),
    ])
      .then(([c, logs, js, birds, s]) => {
        if (ac.signal.aborted) return;
        config = c;
        recentErrors = logs.items;
        jobStats = js;
        systemBirds = birds.items.filter((b) => b.name.startsWith('__bb_'));
        secrets = s;
      })
      .finally(() => {
        if (!ac.signal.aborted) loading = false;
      });
    return () => ac.abort();
  });

  $effect(() => {
    const ac = new AbortController();
    api<DoctorResponse>('/api/doctor')
      .then((d) => {
        if (!ac.signal.aborted) doctor = d;
      })
      .finally(() => {
        if (!ac.signal.aborted) doctorLoading = false;
      });
    return () => ac.abort();
  });

  $effect(() => {
    return onInvalidate((e) => {
      if (e.resource === 'config') {
        api<ConfigResponse>('/api/config')
          .then((c) => {
            config = c;
          })
          .catch(() => {});
      }
      if (e.resource === 'secrets') {
        fetchSecrets();
      }
    });
  });

  function fetchSecrets(): void {
    api<SecretsResponse>('/api/secrets')
      .then((s) => {
        secrets = s;
      })
      .catch(() => {});
  }

  function buildPatch(path: string, value: unknown): Record<string, unknown> {
    const parts = path.split('.');
    let obj: Record<string, unknown> = {};
    const root = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const child: Record<string, unknown> = {};
      obj[parts[i]!] = child;
      obj = child;
    }
    obj[parts[parts.length - 1]!] = value;
    return root;
  }

  async function saveConfigPatch(patch: Record<string, unknown>): Promise<boolean> {
    try {
      const result = await api<ConfigResponse>('/api/config', {
        method: 'PATCH',
        body: patch,
      });
      config = result;
      showToast('Config saved', 'success');
      return true;
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
      return false;
    }
  }

  function startEdit(field: string, _currentValue: string | number): void {
    editingField = field;
    editingSaving = false;
  }

  function cancelEdit(): void {
    editingField = null;
    editingSaving = false;
  }

  async function saveField(
    field: string,
    value: string,
    transform?: (v: string) => unknown,
  ): Promise<void> {
    editingSaving = true;
    const resolved = transform ? transform(value) : value;
    const ok = await saveConfigPatch(buildPatch(field, resolved));
    if (ok) cancelEdit();
    else editingSaving = false;
  }

  async function toggleField(field: string, currentValue: boolean): Promise<void> {
    await saveConfigPatch(buildPatch(field, !currentValue));
  }

  const editor: ConfigEditor = $derived({
    editingField,
    editingSaving,
    startEdit,
    cancelEdit,
    saveField,
    toggleField,
    saveConfigPatch,
  });
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else if config}
  <div class="tabs">
    <button
      class="tab"
      class:tab-active={activeTab === 'config'}
      onclick={() => {
        activeTab = 'config';
      }}>Config</button
    >
    <button
      class="tab"
      class:tab-active={activeTab === 'database'}
      onclick={() => {
        activeTab = 'database';
      }}>Database</button
    >
  </div>

  {#if activeTab === 'config'}
    <ConfigTab
      {config}
      {status}
      {doctor}
      {doctorLoading}
      {editor}
      {secrets}
      onsecretsupdate={fetchSecrets}
    />
  {/if}

  {#if activeTab === 'database'}
    <DatabaseTab {jobStats} {systemBirds} {recentErrors} />
  {/if}
{/if}

<style>
  .tabs {
    display: flex;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 0;
  }

  .tab {
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .tab:hover {
    color: var(--color-text-secondary);
  }

  .tab-active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-accent);
  }
</style>

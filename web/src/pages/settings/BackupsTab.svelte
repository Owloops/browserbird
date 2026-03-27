<script lang="ts">
  import type { BackupInfo, ConfigResponse } from '../../lib/types.ts';
  import { api, apiBase, getAuthToken } from '../../lib/api.ts';
  import { showToast } from '../../lib/toast.svelte.ts';
  import { showConfirm } from '../../lib/confirm.svelte.ts';
  import { onInvalidate } from '../../lib/invalidate.ts';
  import { formatIsoAge } from '../../lib/format.ts';
  import Toggle from '../../components/Toggle.svelte';

  interface Props {
    config: ConfigResponse | null;
    onConfigSave: (patch: Record<string, unknown>) => Promise<boolean>;
  }

  let { config, onConfigSave }: Props = $props();

  const autoEnabled = $derived(config?.database.backups?.auto ?? true);

  let backups: BackupInfo[] = $state([]);
  let loading = $state(true);
  let creating = $state(false);
  let editingMaxCount = $state(false);
  let maxCountValue = $state('');
  let savingMaxCount = $state(false);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function fetchBackups(): Promise<void> {
    try {
      backups = await api<BackupInfo[]>('/api/backups');
    } catch (err) {
      showToast(`Failed to load backups: ${(err as Error).message}`, 'error');
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    fetchBackups();
  });

  $effect(() => {
    return onInvalidate((e) => {
      if (e.resource === 'backups') {
        fetchBackups();
      }
    });
  });

  async function handleCreate(): Promise<void> {
    creating = true;
    try {
      const info = await api<BackupInfo>('/api/backups', { method: 'POST', body: {} });
      showToast(`Backup created: ${info.name}`, 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      creating = false;
    }
  }

  function handleDownload(name: string): void {
    const token = getAuthToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const url = `${apiBase}/api/backups/${encodeURIComponent(name)}${qs}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  }

  async function handleDelete(name: string): Promise<void> {
    if (!(await showConfirm(`Delete backup "${name}"?`))) return;
    try {
      await api(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
      showToast('Backup deleted', 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function handleRestore(name: string): Promise<void> {
    if (
      !(await showConfirm(
        `Restore from "${name}"? Current data will be replaced and the daemon will restart.`,
      ))
    )
      return;
    try {
      await api(`/api/backups/${encodeURIComponent(name)}/restore`, {
        method: 'POST',
        body: {},
      });
      showToast('Backup restored. Daemon restarting...', 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function startEditMaxCount(): void {
    maxCountValue = String(config?.database.backups?.maxCount ?? 10);
    editingMaxCount = true;
  }

  async function saveMaxCount(): Promise<void> {
    const parsed = parseInt(maxCountValue, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      showToast('Max count must be a positive integer', 'error');
      return;
    }
    savingMaxCount = true;
    const ok = await onConfigSave({ database: { backups: { maxCount: parsed } } });
    if (ok) editingMaxCount = false;
    savingMaxCount = false;
  }
</script>

<div class="backups-header">
  <span class="panel-title">Backups</span>
  <button class="btn btn-sm btn-primary" onclick={handleCreate} disabled={creating}>
    {creating ? 'Creating...' : 'Create Backup'}
  </button>
</div>

<div class="panel settings-panel">
  <div class="panel-body">
    <div class="setting-row">
      <div class="setting-label">
        <span class="setting-name">Automatic backups</span>
        <span class="setting-desc">Runs daily at 2:00 AM via system bird</span>
      </div>
      <Toggle
        active={autoEnabled}
        onToggle={() => onConfigSave({ database: { backups: { auto: !autoEnabled } } })}
      />
    </div>
    <div class="setting-row">
      <div class="setting-label">
        <span class="setting-name">Retention</span>
        <span class="setting-desc">Maximum number of backups to keep</span>
      </div>
      {#if editingMaxCount}
        <div class="inline-edit">
          <input
            class="form-input form-input-sm"
            type="number"
            min="1"
            bind:value={maxCountValue}
            onkeydown={(e) => {
              if (e.key === 'Enter') saveMaxCount();
              if (e.key === 'Escape') editingMaxCount = false;
            }}
          />
          <button class="btn btn-sm btn-primary" onclick={saveMaxCount} disabled={savingMaxCount}>
            Save
          </button>
          <button class="btn btn-sm btn-outline" onclick={() => (editingMaxCount = false)}>
            Cancel
          </button>
        </div>
      {:else}
        <button class="setting-value mono clickable" onclick={startEditMaxCount}>
          {config?.database.backups?.maxCount ?? 10}
        </button>
      {/if}
    </div>
  </div>
</div>

{#if loading}
  <div class="loading">Loading...</div>
{:else if backups.length === 0}
  <div class="panel">
    <div class="panel-body">
      <div class="row"><span class="dim">No backups yet</span></div>
    </div>
  </div>
{:else}
  <div class="panel">
    <div class="panel-body">
      {#each backups as backup (backup.name)}
        <div class="backup-row">
          <div class="backup-info">
            <span class="backup-name mono">{backup.name}</span>
            <span class="backup-meta">
              {formatSize(backup.size)} &middot; {formatIsoAge(backup.created)}
            </span>
          </div>
          <div class="backup-actions">
            <button class="btn btn-sm btn-outline" onclick={() => handleDownload(backup.name)}>
              Download
            </button>
            <button class="btn btn-sm btn-outline" onclick={() => handleRestore(backup.name)}>
              Restore
            </button>
            <button class="btn btn-sm btn-danger" onclick={() => handleDelete(backup.name)}>
              Delete
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .backups-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  .settings-panel {
    margin-bottom: var(--space-3);
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2-5) var(--space-4);
    border-bottom: 1px solid rgba(35, 42, 53, 0.5);
  }

  .setting-row:last-child {
    border-bottom: none;
  }

  .setting-label {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .setting-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .setting-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .setting-value {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    background: none;
    border: none;
    padding: 0;
  }

  .clickable {
    cursor: pointer;
    color: var(--color-accent);
  }

  .clickable:hover {
    text-decoration: underline;
  }

  .inline-edit {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .inline-edit .form-input {
    width: 5rem;
  }

  .backup-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid rgba(35, 42, 53, 0.5);
    gap: var(--space-3);
  }

  .backup-row:last-child {
    border-bottom: none;
  }

  .backup-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .backup-name {
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .backup-meta {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .backup-actions {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }
</style>

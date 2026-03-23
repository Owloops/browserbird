<script lang="ts">
  import type { DocInfo, Binding } from '../lib/types.ts';
  import { api, getHashParams } from '../lib/api.ts';
  import { createBindingData } from '../lib/binding-data.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { showConfirm } from '../lib/confirm.svelte.ts';
  import BindingEditor from '../components/BindingEditor.svelte';

  let doc: DocInfo | null = $state(null);
  let loading = $state(true);
  let saving = $state(false);
  let title = $state('');
  let content = $state('');

  const bd = createBindingData();
  const uid = getHashParams().get('id') ?? '';

  $effect(() => {
    if (!uid) {
      window.location.hash = '#/docs';
      return;
    }
    void api<DocInfo>(`/api/docs/${uid}`).then(
      (d) => {
        doc = d;
        title = d.title;
        content = d.content;
        loading = false;
      },
      (err) => {
        showToast(`Failed to load doc: ${(err as Error).message}`, 'error');
        window.location.hash = '#/docs';
      },
    );
  });

  async function save(): Promise<void> {
    if (!doc) return;
    saving = true;
    try {
      await api<DocInfo>(`/api/docs/${doc.uid}`, {
        method: 'PATCH',
        body: { title, content },
      });
      doc = { ...doc, title, content };
      showToast('Saved', 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      saving = false;
    }
  }

  async function deleteDocAction(): Promise<void> {
    if (!doc) return;
    if (!(await showConfirm(`Delete "${doc.title}"?`))) return;
    try {
      await api(`/api/docs/${doc.uid}`, { method: 'DELETE' });
      showToast('Doc deleted', 'success');
      window.location.hash = '#/docs';
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  function handleBindingsUpdate(updated: Binding[]): void {
    if (doc) doc = { ...doc, bindings: updated };
  }

  function handleKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if loading}
  <div class="loading">Loading...</div>
{:else if doc}
  <div class="detail-layout">
    <div class="detail-header">
      <a class="back-link" href="#/docs">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        Docs
      </a>
      <div class="header-actions">
        <button class="btn btn-primary btn-sm" disabled={saving} onclick={save}
          >{saving ? 'Saving...' : 'Save'}</button
        >
        <button class="btn btn-danger btn-sm" onclick={deleteDocAction}>Delete</button>
      </div>
    </div>

    <input class="title-input" type="text" placeholder="Document title" bind:value={title} />

    <div class="bindings-row">
      <span class="bindings-label">Bindings</span>
      <BindingEditor
        bindings={doc.bindings}
        endpoint={`/api/docs/${doc.uid}/bindings`}
        channels={bd.channels}
        birds={bd.birds}
        onupdate={handleBindingsUpdate}
      />
    </div>

    <textarea class="content-editor" placeholder="Write markdown content..." bind:value={content}
    ></textarea>
  </div>
{/if}

<style>
  .detail-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: var(--space-3);
  }

  .detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-muted);
    text-decoration: none;
    font-size: var(--text-sm);
    font-weight: 500;
    transition: color var(--transition-fast);
  }

  .back-link:hover {
    color: var(--color-text-primary);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .title-input {
    width: 100%;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: 600;
    padding: var(--space-2) var(--space-3);
    flex-shrink: 0;
    transition: border-color var(--transition-fast);
  }

  .title-input:focus {
    outline: none;
    border-color: var(--color-accent-dim);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.15);
  }

  .title-input::placeholder {
    color: var(--color-text-muted);
  }

  .bindings-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .bindings-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--color-text-muted);
    padding-top: 4px;
    flex-shrink: 0;
  }

  .content-editor {
    flex: 1;
    min-height: 300px;
    width: 100%;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    line-height: 1.6;
    padding: var(--space-3);
    resize: vertical;
    transition: border-color var(--transition-fast);
  }

  .content-editor:focus {
    outline: none;
    border-color: var(--color-accent-dim);
    box-shadow: 0 0 0 2px rgba(91, 140, 240, 0.15);
  }

  .content-editor::placeholder {
    color: var(--color-text-muted);
  }

  @media (max-width: 768px) {
    .header-actions {
      gap: var(--space-1-5);
    }

    .bindings-row {
      flex-direction: column;
      gap: var(--space-1);
    }
  }
</style>

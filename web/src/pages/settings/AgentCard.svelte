<script lang="ts">
  import type { ConfigResponse } from '../../lib/types.ts';
  import type { ConfigEditor } from './types.ts';
  import InlineEdit from '../../components/InlineEdit.svelte';

  interface Props {
    agent: ConfigResponse['agents'][number];
    index: number;
    agentCount: number;
    editor: ConfigEditor;
    onsavefield: (
      field: string,
      value: string,
      transform?: (v: string) => unknown,
    ) => Promise<void>;
    ondelete: () => void;
  }

  let { agent, index, agentCount, editor, onsavefield, ondelete }: Props = $props();

  let editValue = $state('');

  function handleStartEdit(field: string, currentValue: string | number): void {
    editValue = String(currentValue);
    editor.startEdit(`agent.${index}.${field}`, currentValue);
  }

  function isEditing(field: string): boolean {
    return editor.editingField === `agent.${index}.${field}`;
  }
</script>

<div class="agent-card">
  <div class="agent-bar"></div>
  <div class="agent-top">
    <div class="agent-identity">
      {#if isEditing('name')}
        <InlineEdit
          bind:value={editValue}
          saving={editor.editingSaving}
          onsave={(v) => onsavefield('name', v)}
          oncancel={editor.cancelEdit}
        />
      {:else}
        <button
          class="val-btn agent-name editable"
          onclick={() => handleStartEdit('name', agent.name)}>{agent.name}</button
        >
      {/if}
      <span class="agent-id mono">{agent.id}</span>
    </div>
    <div class="agent-actions">
      {#if agentCount > 1}
        <button class="btn btn-outline btn-sm btn-danger" onclick={ondelete}>Delete</button>
      {/if}
    </div>
  </div>
  <div class="agent-fields">
    <div class="agent-field">
      <span class="row-label">Model</span>
      {#if isEditing('model')}
        <InlineEdit
          bind:value={editValue}
          mono
          saving={editor.editingSaving}
          onsave={(v) => onsavefield('model', v)}
          oncancel={editor.cancelEdit}
        />
      {:else}
        <button class="val-btn mono editable" onclick={() => handleStartEdit('model', agent.model)}
          >{agent.model}</button
        >
      {/if}
    </div>
    <div class="agent-field">
      <span class="row-label">Fallback</span>
      {#if isEditing('fallbackModel')}
        <InlineEdit
          bind:value={editValue}
          mono
          saving={editor.editingSaving}
          placeholder="none"
          onsave={(v) => onsavefield('fallbackModel', v, (s) => s.trim() || null)}
          oncancel={editor.cancelEdit}
        />
      {:else}
        <button
          class="val-btn mono editable"
          onclick={() => handleStartEdit('fallbackModel', agent.fallbackModel ?? '')}
          >{agent.fallbackModel ?? 'none'}</button
        >
      {/if}
    </div>
    <div class="agent-field">
      <span class="row-label">Budget</span>
      {#if isEditing('maxBudgetUsd')}
        <InlineEdit
          bind:value={editValue}
          mono
          saving={editor.editingSaving}
          placeholder="none"
          onsave={(v) =>
            onsavefield('maxBudgetUsd', v, (s) => {
              const trimmed = s.trim();
              if (!trimmed) return null;
              const n = Number(trimmed);
              return n > 0 ? n : null;
            })}
          oncancel={editor.cancelEdit}
        />
      {:else}
        <button
          class="val-btn mono editable"
          onclick={() =>
            handleStartEdit(
              'maxBudgetUsd',
              agent.maxBudgetUsd != null ? String(agent.maxBudgetUsd) : '',
            )}>{agent.maxBudgetUsd != null ? `$${agent.maxBudgetUsd}` : 'none'}</button
        >
      {/if}
    </div>
    <div class="agent-field">
      <span class="row-label">Turns</span>
      {#if isEditing('maxTurns')}
        <InlineEdit
          bind:value={editValue}
          mono
          saving={editor.editingSaving}
          onsave={(v) => onsavefield('maxTurns', v, (s) => Number(s))}
          oncancel={editor.cancelEdit}
        />
      {:else}
        <button
          class="val-btn mono editable"
          onclick={() => handleStartEdit('maxTurns', agent.maxTurns)}>{agent.maxTurns}</button
        >
      {/if}
    </div>
    <div class="agent-field">
      <span class="row-label">Timeout</span>
      {#if isEditing('processTimeoutMs')}
        <InlineEdit
          bind:value={editValue}
          mono
          saving={editor.editingSaving}
          placeholder="global"
          onsave={(v) =>
            onsavefield('processTimeoutMs', v, (s) => {
              const trimmed = s.trim();
              if (!trimmed) return null;
              return Number(trimmed) * 1000;
            })}
          oncancel={editor.cancelEdit}
        />
      {:else}
        <button
          class="val-btn mono editable"
          onclick={() =>
            handleStartEdit(
              'processTimeoutMs',
              agent.processTimeoutMs ? String(agent.processTimeoutMs / 1000) : '',
            )}>{agent.processTimeoutMs ? `${agent.processTimeoutMs / 1000}s` : 'global'}</button
        >
      {/if}
    </div>
    <div class="agent-field">
      <span class="row-label">Channels</span>
      {#if isEditing('channels')}
        <InlineEdit
          bind:value={editValue}
          mono
          saving={editor.editingSaving}
          onsave={(v) =>
            onsavefield('channels', v, (s) =>
              s
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean),
            )}
          oncancel={editor.cancelEdit}
        />
      {:else}
        <button
          class="val-btn mono editable"
          onclick={() => handleStartEdit('channels', agent.channels.join(', '))}
          >{agent.channels.join(', ') || '*'}</button
        >
      {/if}
    </div>
  </div>
  <div class="agent-prompt-area">
    <span class="row-label">System Prompt</span>
    {#if isEditing('systemPrompt')}
      <InlineEdit
        bind:value={editValue}
        multiline
        saving={editor.editingSaving}
        onsave={(v) => onsavefield('systemPrompt', v)}
        oncancel={editor.cancelEdit}
      />
    {:else}
      <button
        class="prompt-block editable"
        onclick={() => handleStartEdit('systemPrompt', agent.systemPrompt)}
        >{agent.systemPrompt}</button
      >
    {/if}
  </div>
</div>

<style>
  .agent-card {
    position: relative;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: var(--space-3);
    transition:
      border-color var(--transition-normal),
      box-shadow var(--transition-normal);
  }

  .agent-card:hover {
    border-color: var(--color-border-subtle);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }

  .agent-bar {
    height: 2px;
    background: linear-gradient(90deg, var(--color-accent), transparent);
  }

  .agent-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    gap: var(--space-2);
  }

  .agent-identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .agent-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .agent-id {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .agent-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .agent-fields {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
  }

  .agent-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2-5) var(--space-4);
    border-right: 1px solid rgba(35, 42, 53, 0.5);
  }

  .agent-field:last-child {
    border-right: none;
  }

  .agent-prompt-area {
    padding: var(--space-2-5) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .prompt-block {
    background: var(--color-bg-deep);
    border: 1px solid rgba(35, 42, 53, 0.5);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: 1.6;
    text-align: left;
    cursor: pointer;
    font-family: var(--font-sans);
    transition:
      border-color var(--transition-fast),
      color var(--transition-fast);
  }

  .prompt-block:hover {
    border-color: var(--color-accent-dim);
    color: var(--color-text-primary);
  }

  @media (max-width: 960px) {
    .agent-fields {
      grid-template-columns: repeat(3, 1fr);
    }

    .agent-field:nth-child(3n) {
      border-right: none;
    }

    .agent-field:nth-child(-n + 3) {
      border-bottom: 1px solid rgba(35, 42, 53, 0.5);
    }
  }

  @media (max-width: 640px) {
    .agent-fields {
      grid-template-columns: 1fr;
    }

    .agent-field {
      border-right: none;
      border-bottom: 1px solid rgba(35, 42, 53, 0.5);
    }

    .agent-field:last-child {
      border-bottom: none;
    }

    .agent-top {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-2);
    }
  }
</style>

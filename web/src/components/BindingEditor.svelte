<script lang="ts">
  import type { Binding, CronJobRow } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  interface Props {
    bindings: Binding[];
    endpoint: string;
    channels: string[];
    birds: CronJobRow[];
    emptyLabel?: string;
    onupdate?: (bindings: Binding[]) => void;
  }

  let { bindings, endpoint, channels, birds, emptyLabel = 'Global', onupdate }: Props = $props();

  let adding = $state(false);
  let bindingType: 'channel' | 'bird' = $state('channel');
  let bindingTargetId = $state('');
  let saving = $state(false);

  const targets = $derived.by(() => {
    if (bindingType === 'channel') {
      return channels.map((ch) => ({ value: ch, label: ch }));
    }
    return birds.map((b) => ({ value: b.uid, label: b.name }));
  });

  function bindingLabel(b: Binding): string {
    if (b.targetType === 'bird') {
      const bird = birds.find((br) => br.uid === b.targetId);
      return bird ? bird.name : b.targetId.slice(0, 10);
    }
    return b.targetId;
  }

  function toggleAdding(): void {
    adding = !adding;
    bindingType = 'channel';
    bindingTargetId = '';
  }

  async function addBinding(): Promise<void> {
    if (!bindingTargetId) return;
    saving = true;
    try {
      const already = bindings.some(
        (b) => b.targetType === bindingType && b.targetId === bindingTargetId,
      );
      if (already) {
        showToast('Binding already exists', 'info');
        saving = false;
        return;
      }
      const updated = [...bindings, { targetType: bindingType, targetId: bindingTargetId }];
      await api(endpoint, { method: 'PUT', body: updated });
      onupdate?.(updated);
      showToast('Binding added', 'success');
      bindingTargetId = '';
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      saving = false;
    }
  }

  async function removeBinding(binding: Binding): Promise<void> {
    const updated = bindings.filter(
      (b) => !(b.targetType === binding.targetType && b.targetId === binding.targetId),
    );
    try {
      await api(endpoint, { method: 'PUT', body: updated });
      onupdate?.(updated);
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }
</script>

<div class="bindings-cell">
  {#if bindings.length === 0 && emptyLabel}
    <span class="scope-empty">{emptyLabel}</span>
  {/if}
  {#each bindings as binding}
    <span class="chip">
      <span class="chip-type">{binding.targetType}</span>
      <span class="chip-label">{bindingLabel(binding)}</span>
      <button
        class="chip-remove"
        onclick={() => removeBinding(binding)}
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
  <button class="chip chip-add" class:chip-add-active={adding} onclick={toggleAdding}>
    {#if adding}
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
  {#if adding}
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
        {#each targets as t}
          <option value={t.value}>{t.label}</option>
        {/each}
      </select>
      <button
        class="btn btn-primary btn-sm"
        disabled={saving || !bindingTargetId}
        onclick={addBinding}>Add</button
      >
    </div>
  {/if}
</div>

<style>
  .bindings-cell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .scope-empty {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-style: italic;
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
</style>

<script lang="ts">
  import type { SessionDetail } from '../lib/types.ts';
  import { api, getHashParams } from '../lib/api.ts';
  import Chat from './Chat.svelte';

  const params = getHashParams();
  const sessionUid = params.get('id') ?? undefined;
  const isNew = params.get('new') === 'true';

  let channelId: string | null = $state(null);
  let agentId: string | null = $state(null);
  let loading = $state(!!sessionUid && !isNew);

  const isWebSession = $derived(isNew || channelId === 'web');

  $effect(() => {
    if (!sessionUid || isNew) return;
    const ac = new AbortController();
    api<SessionDetail>(`/api/sessions/${sessionUid}`)
      .then((data) => {
        if (!ac.signal.aborted) {
          channelId = data.session.channel_id;
          agentId = data.session.agent_id;
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) loading = false;
      });
    return () => ac.abort();
  });

  function navigateBack(): void {
    window.location.hash = '#/sessions';
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <div class="detail-header">
    <button class="btn btn-outline btn-sm" onclick={navigateBack}>
      <svg class="back-icon" viewBox="0 0 6 10" fill="none" aria-hidden="true">
        <path
          d="M5 1L1 5L5 9"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      Sessions
    </button>
    {#if channelId}
      <span class="session-meta">
        <span class="mono">{channelId}</span>
        <span class="meta-sep"></span>
        <span>{agentId}</span>
      </span>
    {/if}
  </div>

  <Chat initialSessionUid={isNew ? undefined : sessionUid} readonly={!isWebSession} />
{/if}

<style>
  .detail-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .back-icon {
    width: 6px;
    height: 10px;
    vertical-align: middle;
  }

  .session-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .meta-sep {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--color-text-muted);
    flex-shrink: 0;
    opacity: 0.5;
  }
</style>

<script lang="ts">
  import { getHashParams } from '../lib/api.ts';
  import Chat from './Chat.svelte';

  const params = getHashParams();
  const sessionUid = params.get('id') ?? undefined;
  const isNew = params.get('new') === 'true';

  function navigateBack(): void {
    window.location.hash = '#/sessions';
  }
</script>

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
  {#if !isNew && sessionUid}
    <span class="session-uid">{sessionUid.slice(0, 8)}</span>
  {/if}
</div>

<Chat initialSessionUid={isNew ? undefined : sessionUid} />

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

  .session-uid {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }
</style>

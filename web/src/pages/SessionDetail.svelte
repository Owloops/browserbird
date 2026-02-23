<script lang="ts">
  import type { SessionDetail } from '../lib/types.ts';
  import { api, getHashParams } from '../lib/api.ts';
  import { formatAge } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';
  import StatCard from '../components/StatCard.svelte';

  const PER_PAGE = 20;

  const sessionId = Number(getHashParams().get('id'));

  let detail: SessionDetail | null = $state(null);
  let loading = $state(true);
  let error = $state('');
  let page = $state(1);

  async function fetchDetail(p: number, signal: AbortSignal): Promise<void> {
    if (!Number.isFinite(sessionId)) {
      error = 'Invalid session ID';
      loading = false;
      return;
    }
    try {
      const data = await api<SessionDetail>(
        `/api/sessions/${sessionId}?page=${p}&perPage=${PER_PAGE}`,
      );
      if (signal.aborted) return;
      detail = data;
    } catch (err) {
      if (!signal.aborted) error = (err as Error).message;
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  $effect(() => {
    const p = page;
    const ac = new AbortController();
    loading = true;
    fetchDetail(p, ac.signal);
    return () => ac.abort();
  });

  function navigateBack(): void {
    window.location.hash = '#/sessions';
  }
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else if error}
  <div class="error-state">
    <p>{error}</p>
    <button class="btn btn-outline btn-sm" onclick={navigateBack}>Back to Sessions</button>
  </div>
{:else if detail}
  <div class="detail-header">
    <button class="btn btn-outline btn-sm" onclick={navigateBack}>← Sessions</button>
    <h2 class="session-title">Session #{detail.session.id}</h2>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <span class="meta-label">Channel</span>
      <span class="meta-value mono">{detail.session.slack_channel_id}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Thread</span>
      <span class="meta-value mono">{detail.session.slack_thread_ts ?? '—'}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Agent</span>
      <span class="meta-value">{detail.session.agent_id}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Created</span>
      <span class="meta-value">{formatAge(detail.session.created_at)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Last Active</span>
      <span class="meta-value">{formatAge(detail.session.last_active)}</span>
    </div>
  </div>

  <div class="stat-cards">
    <StatCard label="Messages" value={detail.session.message_count} />
    <StatCard label="Tokens In" value={detail.stats.totalTokensIn.toLocaleString()} variant="info" />
    <StatCard label="Tokens Out" value={detail.stats.totalTokensOut.toLocaleString()} variant="info" />
  </div>

  <DataTable
    columns={['Dir', 'User', 'Content', 'Tokens In', 'Tokens Out', 'Time']}
    isEmpty={detail.messages.items.length === 0}
    emptyMessage="No messages recorded for this session"
    {page}
    totalPages={detail.messages.totalPages}
    totalItems={detail.messages.totalItems}
    onPageChange={(p) => {
      page = p;
    }}
  >
    {#each detail.messages.items as m (m.id)}
      <tr>
        <td><Badge status={m.direction === 'in' ? 'info' : 'success'} /></td>
        <td class="mono">{m.slack_user_id}</td>
        <td class="content-cell">{m.content ?? '—'}</td>
        <td class="mono">{m.tokens_in ?? '—'}</td>
        <td class="mono">{m.tokens_out ?? '—'}</td>
        <td>{formatAge(m.created_at)}</td>
      </tr>
    {/each}
  </DataTable>
{/if}

<style>
  .detail-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .session-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
  }

  .meta-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 2rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .meta-label {
    font-size: 0.667rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .meta-value {
    font-size: 0.867rem;
    color: var(--color-text-secondary);
  }

  .stat-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.625rem;
    margin-bottom: 1rem;
  }

  .content-cell {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    color: var(--color-error);
  }

  @media (max-width: 768px) {
    .stat-cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>

<script lang="ts">
  import type { ColumnDef, SessionDetail, SessionRow, MessageRow } from '../lib/types.ts';
  import { getHashParams } from '../lib/api.ts';
  import { createDataTable } from '../lib/data-table.svelte.ts';
  import { formatAge } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';
  import StatCard from '../components/StatCard.svelte';

  const sessionId = Number(getHashParams().get('id'));

  const columns: ColumnDef[] = [
    { key: 'direction', label: 'Dir' },
    { key: 'user_id', label: 'User', sortable: true },
    { key: 'content', label: 'Content' },
    { key: 'tokens_in', label: 'Tokens In' },
    { key: 'tokens_out', label: 'Tokens Out' },
    { key: 'created_at', label: 'Time', sortable: true },
  ];

  let session: SessionRow | null = $state(null);
  let stats: { totalTokensIn: number; totalTokensOut: number } | null = $state(null);
  let error = $state('');

  const table = Number.isFinite(sessionId)
    ? createDataTable<MessageRow, SessionDetail>({
        endpoint: `/api/sessions/${sessionId}`,
        columns,
        defaultSort: 'created_at',
        invalidateOn: 'sessions',
        transformResponse: (raw) => raw.messages,
        onResponse: (raw) => {
          session = raw.session;
          stats = raw.stats;
        },
      })
    : null;

  if (!table) error = 'Invalid session ID';

  function navigateBack(): void {
    window.location.hash = '#/sessions';
  }
</script>

{#if error}
  <div class="error-state">
    <p>{error}</p>
    <button class="btn btn-outline btn-sm" onclick={navigateBack}>Back to Sessions</button>
  </div>
{:else if table?.loading}
  <div class="loading">Loading...</div>
{:else if session && stats && table}
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
    <h2 class="session-title">Session #{session.id}</h2>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <span class="meta-label">Channel</span>
      <span class="meta-value mono">{session.channel_id}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Thread</span>
      <span class="meta-value mono">{session.thread_id ?? '-'}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Agent</span>
      <span class="meta-value">{session.agent_id}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Created</span>
      <span class="meta-value">{formatAge(session.created_at)}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Last Active</span>
      <span class="meta-value">{formatAge(session.last_active)}</span>
    </div>
  </div>

  <div class="stat-cards">
    <StatCard label="Messages" value={session.message_count} />
    <StatCard label="Tokens In" value={stats.totalTokensIn.toLocaleString()} variant="info" />
    <StatCard label="Tokens Out" value={stats.totalTokensOut.toLocaleString()} variant="info" />
  </div>

  <DataTable
    {columns}
    isEmpty={table.items.length === 0}
    emptyMessage="No messages recorded for this session"
    fetching={table.fetching}
    page={table.page}
    totalPages={table.totalPages}
    totalItems={table.totalItems}
    sort={table.sort}
    search={table.search}
    searchPlaceholder="Search messages..."
    onPageChange={table.setPage}
    onSortChange={table.setSort}
    onSearchChange={table.setSearch}
  >
    {#each table.items as m (m.id)}
      <tr>
        <td><Badge status={m.direction === 'in' ? 'info' : 'success'} /></td>
        <td class="mono">{m.user_id}</td>
        <td class="content-cell">{m.content ?? '-'}</td>
        <td class="mono">{m.tokens_in ?? '-'}</td>
        <td class="mono">{m.tokens_out ?? '-'}</td>
        <td>{formatAge(m.created_at)}</td>
      </tr>
    {/each}
  </DataTable>
{/if}

<style>
  .detail-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .back-icon {
    width: 6px;
    height: 10px;
    vertical-align: middle;
  }

  .session-title {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
  }

  .meta-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .meta-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .meta-value {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  .stat-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2-5);
    margin-bottom: var(--space-4);
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
    gap: var(--space-3);
    color: var(--color-error);
  }

  @media (max-width: 768px) {
    .stat-cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>

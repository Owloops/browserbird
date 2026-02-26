<script lang="ts">
  import type { ColumnDef, SessionDetail, SessionRow, MessageRow } from '../lib/types.ts';
  import { getHashParams } from '../lib/api.ts';
  import { createDataTable } from '../lib/data-table.svelte.ts';
  import { formatAge, shortUid, timeStamp } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';
  import Badge from '../components/Badge.svelte';
  import StatCard from '../components/StatCard.svelte';

  const sessionUid = getHashParams().get('id') ?? '';

  const columns: ColumnDef[] = [
    { key: 'direction', label: 'Dir' },
    { key: 'user_id', label: 'User', sortable: true },
    { key: 'content', label: 'Content' },
    { key: 'tokens_in', label: 'Tokens In' },
    { key: 'tokens_out', label: 'Tokens Out' },
    { key: 'created_at', label: 'Time', sortable: true },
  ];

  let lastUpdated = $state(timeStamp());
  let session: SessionRow | null = $state(null);
  let stats: { totalTokensIn: number; totalTokensOut: number } | null = $state(null);
  let error = $state('');

  const table = sessionUid
    ? createDataTable<MessageRow, SessionDetail>({
        endpoint: `/api/sessions/${sessionUid}`,
        columns,
        defaultSort: 'created_at',
        invalidateOn: 'sessions',
        transformResponse: (raw) => raw.messages,
        onResponse: (raw) => {
          lastUpdated = timeStamp();
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
    <h2 class="session-title">Session {shortUid(session.uid)}</h2>
    <span class="session-meta">
      <span class="mono">{session.channel_id}</span>
      <span class="meta-sep"></span>
      {session.agent_id}
      <span class="meta-sep"></span>
      {formatAge(session.last_active)}
    </span>
  </div>

  <div class="stat-cards">
    <StatCard label="Messages" value={session.message_count} />
    <StatCard label="Tokens In" value={stats.totalTokensIn.toLocaleString()} />
    <StatCard label="Tokens Out" value={stats.totalTokensOut.toLocaleString()} />
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
    {#snippet toolbar()}
      <div class="filter-spacer"></div>
      <span class="last-updated">Updated {lastUpdated}</span>
    {/snippet}
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
  .filter-spacer {
    flex: 1;
  }

  .last-updated {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

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
    flex-shrink: 0;
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

  .stat-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-5);
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

    .detail-header {
      flex-wrap: wrap;
    }

    .session-meta {
      flex-basis: 100%;
      flex-wrap: wrap;
    }

    .content-cell {
      max-width: 160px;
    }
  }

  @media (max-width: 480px) {
    .stat-cards {
      grid-template-columns: 1fr;
    }
  }
</style>

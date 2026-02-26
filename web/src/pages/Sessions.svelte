<script lang="ts">
  import type { ColumnDef, SessionRow } from '../lib/types.ts';
  import { createDataTable } from '../lib/data-table.svelte.ts';
  import { formatAge, shortUid, timeStamp } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';

  const columns: ColumnDef[] = [
    { key: 'uid', label: 'ID', sortable: true },
    { key: 'channel_id', label: 'Channel', sortable: true },
    { key: 'thread_id', label: 'Thread' },
    { key: 'agent_id', label: 'Agent', sortable: true },
    { key: 'message_count', label: 'Messages', sortable: true },
    { key: 'last_active', label: 'Last Active', sortable: true },
  ];

  let lastUpdated = $state(timeStamp());

  const table = createDataTable<SessionRow>({
    endpoint: '/api/sessions',
    columns,
    defaultSort: '-last_active',
    invalidateOn: 'sessions',
    onResponse: () => {
      lastUpdated = timeStamp();
    },
  });
</script>

{#if table.loading}
  <div class="loading">Loading...</div>
{:else}
  <DataTable
    {columns}
    isEmpty={table.items.length === 0}
    emptyMessage="No active sessions"
    fetching={table.fetching}
    page={table.page}
    totalPages={table.totalPages}
    totalItems={table.totalItems}
    sort={table.sort}
    search={table.search}
    searchPlaceholder="Search sessions..."
    onPageChange={table.setPage}
    onSortChange={table.setSort}
    onSearchChange={table.setSearch}
  >
    {#snippet toolbar()}
      <div class="filter-spacer"></div>
      <span class="last-updated">Updated {lastUpdated}</span>
    {/snippet}
    {#each table.items as s (s.uid)}
      <tr
        class="clickable-row"
        onclick={() => {
          window.location.hash = `#/session-detail?id=${s.uid}`;
        }}
      >
        <td class="mono">{shortUid(s.uid)}</td>
        <td class="mono">{s.channel_id}</td>
        <td class="mono">{s.thread_id ?? '-'}</td>
        <td>{s.agent_id}</td>
        <td>{s.message_count}</td>
        <td>{formatAge(s.last_active)}</td>
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

  .clickable-row {
    cursor: pointer;
  }
</style>

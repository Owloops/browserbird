<script lang="ts">
  import type { ColumnDef, SessionRow } from '../lib/types.ts';
  import { createDataTable } from '../lib/data-table.svelte.ts';
  import { formatAge } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';

  const columns: ColumnDef[] = [
    { key: 'id', label: 'ID', sortable: true },
    { key: 'channel_id', label: 'Channel', sortable: true },
    { key: 'thread_id', label: 'Thread' },
    { key: 'agent_id', label: 'Agent', sortable: true },
    { key: 'message_count', label: 'Messages', sortable: true },
    { key: 'last_active', label: 'Last Active', sortable: true },
  ];

  const table = createDataTable<SessionRow>({
    endpoint: '/api/sessions',
    columns,
    defaultSort: '-last_active',
    invalidateOn: 'sessions',
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
    {#each table.items as s (s.id)}
      <tr
        class="clickable-row"
        onclick={() => {
          window.location.hash = `#/session-detail?id=${s.id}`;
        }}
      >
        <td class="mono">{s.id}</td>
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
  .clickable-row {
    cursor: pointer;
  }
</style>

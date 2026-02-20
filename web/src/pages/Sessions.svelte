<script lang="ts">
  import type { PaginatedResult, SessionRow } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import { formatAge } from '../lib/format.ts';
  import DataTable from '../components/DataTable.svelte';

  const PER_PAGE = 20;

  let sessions: SessionRow[] = $state([]);
  let totalPages = $state(1);
  let totalItems = $state(0);
  let page = $state(1);
  let loading = $state(true);

  async function fetchSessions(p: number, signal: AbortSignal): Promise<void> {
    try {
      const data = await api<PaginatedResult<SessionRow>>(
        `/api/sessions?page=${p}&perPage=${PER_PAGE}`,
      );
      if (signal.aborted) return;
      sessions = data.items;
      totalPages = data.totalPages;
      totalItems = data.totalItems;
    } catch {
    } finally {
      if (!signal.aborted) loading = false;
    }
  }

  $effect(() => {
    const p = page;
    const ac = new AbortController();
    fetchSessions(p, ac.signal);
    const timer = setInterval(() => fetchSessions(p, ac.signal), 15_000);
    return () => {
      ac.abort();
      clearInterval(timer);
    };
  });
</script>

{#if loading}
  <div class="loading">Loading...</div>
{:else}
  <DataTable
    columns={['ID', 'Channel', 'Thread', 'Agent', 'Messages', 'Last Active']}
    isEmpty={sessions.length === 0}
    emptyMessage="No active sessions"
    {page}
    {totalPages}
    {totalItems}
    onPageChange={(p) => {
      page = p;
    }}
  >
    {#each sessions as s (s.id)}
      <tr>
        <td class="mono">{s.id}</td>
        <td class="mono">{s.slack_channel_id}</td>
        <td class="mono">{s.slack_thread_ts ?? '—'}</td>
        <td>{s.agent_id}</td>
        <td>{s.message_count}</td>
        <td>{formatAge(s.last_active)}</td>
      </tr>
    {/each}
  </DataTable>
{/if}

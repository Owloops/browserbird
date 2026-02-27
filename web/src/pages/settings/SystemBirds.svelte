<script lang="ts">
  import type { CronJobRow, FlightRow, PaginatedResult } from '../../lib/types.ts';
  import { api } from '../../lib/api.ts';
  import { formatAge, flightDuration, shortUid } from '../../lib/format.ts';
  import { showToast } from '../../lib/toast.svelte.ts';
  import Badge from '../../components/Badge.svelte';

  interface Props {
    birds: CronJobRow[];
  }

  let { birds }: Props = $props();

  let systemFlights: Record<string, FlightRow[]> = $state({});

  async function loadFlights(birdUid: string): Promise<void> {
    if (systemFlights[birdUid]) return;
    try {
      const result = await api<PaginatedResult<FlightRow>>(
        `/api/birds/${birdUid}/flights?perPage=5`,
      );
      systemFlights = { ...systemFlights, [birdUid]: result.items };
    } catch {
      systemFlights = { ...systemFlights, [birdUid]: [] };
    }
  }

  async function fly(uid: string, name: string): Promise<void> {
    try {
      const result = await api<{ success: boolean; jobId: number }>(`/api/birds/${uid}/fly`, {
        method: 'POST',
      });
      showToast(`${name} sent on a flight (job #${result.jobId})`, 'success');
      const { [uid]: _, ...rest } = systemFlights;
      systemFlights = rest;
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">System Birds</span>
    <span class="bird-count mono">{birds.length}</span>
  </div>
  <div class="panel-body">
    {#if birds.length === 0}
      <div class="row"><span class="dim">No system birds registered</span></div>
    {:else}
      {#each birds as bird, i (bird.uid)}
        <div class="bird-entry" class:bird-entry-border={i < birds.length - 1}>
          <div class="bird-top">
            <div class="bird-info">
              <span class="bird-name mono">{bird.name}</span>
              <span class="bird-schedule mono dim">{bird.schedule}</span>
            </div>
            <div class="bird-actions">
              {#if bird.last_run}
                <span class="bird-last-run">
                  {formatAge(bird.last_run)}
                  {#if bird.last_status}
                    <Badge status={bird.last_status} />
                  {/if}
                </span>
              {/if}
              {#if !systemFlights[bird.uid]}
                <button class="btn btn-outline btn-sm" onclick={() => loadFlights(bird.uid)}
                  >Flights</button
                >
              {/if}
              <button class="btn btn-outline btn-sm" onclick={() => fly(bird.uid, bird.name)}
                >Fly</button
              >
            </div>
          </div>
          {#if systemFlights[bird.uid] != null}
            <div class="flight-list">
              {#if systemFlights[bird.uid]!.length === 0}
                <div class="flight-empty"><span class="dim">No flights recorded</span></div>
              {:else}
                {#each systemFlights[bird.uid] as flight (flight.uid)}
                  <div class="flight-row">
                    <span class="mono flight-id">{shortUid(flight.uid)}</span>
                    <Badge status={flight.status} />
                    <span class="mono">{flightDuration(flight.started_at, flight.finished_at)}</span
                    >
                    <span class="flight-time">{formatAge(flight.started_at)}</span>
                  </div>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .bird-count {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .bird-entry {
    padding: 0;
  }

  .bird-entry-border {
    border-bottom: 1px solid var(--color-border);
  }

  .bird-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2-5) var(--space-4);
    gap: var(--space-2);
  }

  .bird-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .bird-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .bird-schedule {
    font-size: var(--text-xs);
  }

  .bird-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .bird-last-run {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .flight-list {
    border-top: 1px solid rgba(35, 42, 53, 0.5);
    background: var(--color-bg-deep);
  }

  .flight-empty {
    padding: var(--space-2) var(--space-4);
  }

  .flight-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-4);
    border-bottom: 1px solid rgba(35, 42, 53, 0.3);
    font-size: var(--text-sm);
  }

  .flight-row:last-child {
    border-bottom: none;
  }

  .flight-id {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    min-width: 3rem;
  }

  .flight-time {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    margin-left: auto;
  }

  @media (max-width: 640px) {
    .bird-top {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-1-5);
    }

    .flight-row {
      flex-wrap: wrap;
    }
  }
</style>

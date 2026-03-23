/** @fileoverview Shared reactive state for binding editor dependencies (channels + birds). */

import type { ConfigResponse, CronJobRow, PaginatedResult } from './types.ts';
import { api } from './api.ts';

export function createBindingData() {
  let config = $state<ConfigResponse | null>(null);
  let birds: CronJobRow[] = $state([]);

  $effect(() => {
    const ac = new AbortController();
    api<ConfigResponse>('/api/config')
      .then((c) => {
        if (!ac.signal.aborted) config = c;
      })
      .catch(() => {});
    api<PaginatedResult<CronJobRow>>('/api/birds?perPage=100')
      .then((data) => {
        if (!ac.signal.aborted) birds = data.items.filter((b) => !b.name.startsWith('__bb_'));
      })
      .catch(() => {});
    return () => ac.abort();
  });

  return {
    get channels() {
      return config?.slack.channels ?? [];
    },
    get birds() {
      return birds;
    },
  };
}

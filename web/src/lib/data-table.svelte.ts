/** @fileoverview Composable for paginated, sortable, searchable server tables with SSE invalidation. */

import type { PaginatedResult } from './types.ts';
import { api, getHashParams } from './api.ts';
import { onInvalidate } from './invalidate.ts';

export interface DataTableConfig<T, R = PaginatedResult<T>> {
  endpoint: string;
  columns: { key: string; label: string; sortable?: boolean; class?: string }[];
  defaultSort?: string;
  defaultPerPage?: number;
  invalidateOn?: string;
  buildParams?: () => Record<string, string>;
  watchExtras?: () => unknown;
  transformResponse?: (raw: R) => PaginatedResult<T>;
  onResponse?: (raw: R) => void;
}

function readHashState(defaultSort: string): { page: number; sort: string; search: string } {
  const hp = getHashParams();
  return {
    page: Math.max(Number(hp.get('page')) || 1, 1),
    sort: hp.get('sort') ?? defaultSort,
    search: hp.get('search') ?? '',
  };
}

function writeHashState(page: number, sort: string, search: string, defaultSort: string): void {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  const basePath = qIndex === -1 ? hash : hash.slice(0, qIndex);
  const existing = new URLSearchParams(qIndex === -1 ? '' : hash.slice(qIndex + 1));

  if (page > 1) existing.set('page', String(page));
  else existing.delete('page');

  if (sort && sort !== defaultSort) existing.set('sort', sort);
  else existing.delete('sort');

  if (search) existing.set('search', search);
  else existing.delete('search');

  const qs = existing.toString();
  const newHash = qs ? `${basePath}?${qs}` : basePath;
  if (newHash !== hash) {
    history.replaceState(null, '', newHash);
  }
}

export function createDataTable<T, R = PaginatedResult<T>>(config: DataTableConfig<T, R>) {
  const defaultSort = config.defaultSort ?? '';
  const initial = readHashState(defaultSort);

  let items: T[] = $state([]);
  let page = $state(initial.page);
  let totalPages = $state(1);
  let totalItems = $state(0);
  let perPage = $state(config.defaultPerPage ?? 15);
  let loading = $state(true);
  let sort = $state(initial.sort);
  let search = $state(initial.search);

  $effect(() => {
    writeHashState(page, sort, search, defaultSort);
  });

  $effect(() => {
    const currentPage = page;
    const currentSort = sort;
    const currentSearch = search;
    const currentPerPage = perPage;
    config.watchExtras?.();

    const ac = new AbortController();

    const doFetch = async () => {
      const params = new URLSearchParams();
      params.set('page', String(currentPage));
      params.set('perPage', String(currentPerPage));
      if (currentSort && currentSort !== defaultSort) params.set('sort', currentSort);
      if (currentSearch) params.set('search', currentSearch);

      const extra = config.buildParams?.();
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          if (v) params.set(k, v);
        }
      }

      const separator = config.endpoint.includes('?') ? '&' : '?';
      try {
        const raw = await api<R>(`${config.endpoint}${separator}${params.toString()}`);
        if (ac.signal.aborted) return;
        config.onResponse?.(raw);
        const paginated = config.transformResponse
          ? config.transformResponse(raw)
          : (raw as unknown as PaginatedResult<T>);
        items = paginated.items;
        totalPages = paginated.totalPages;
        totalItems = paginated.totalItems;
        perPage = paginated.perPage;
      } catch {
        // connection check handles display
      } finally {
        if (!ac.signal.aborted) loading = false;
      }
    };

    loading = true;
    doFetch();

    const unsub = config.invalidateOn
      ? onInvalidate((e) => {
          if (e.resource === config.invalidateOn) doFetch();
        })
      : () => {};

    return () => {
      ac.abort();
      unsub();
    };
  });

  function setPage(p: number): void {
    page = p;
  }

  function setSort(key: string): void {
    if (sort === key) {
      sort = `-${key}`;
    } else if (sort === `-${key}`) {
      sort = key;
    } else {
      sort = `-${key}`;
    }
    page = 1;
  }

  function setSearch(s: string): void {
    search = s;
    page = 1;
  }

  function refetch(): void {
    page = page;
  }

  return {
    get items() {
      return items;
    },
    get page() {
      return page;
    },
    get totalPages() {
      return totalPages;
    },
    get totalItems() {
      return totalItems;
    },
    get perPage() {
      return perPage;
    },
    get loading() {
      return loading;
    },
    get sort() {
      return sort;
    },
    get search() {
      return search;
    },
    setPage,
    setSort,
    setSearch,
    refetch,
  };
}

# Svelte 5 Style Guide

Based on [Svelte 5 documentation](https://svelte.dev/docs/svelte) and patterns established in this project.

**Framework constraint:** Svelte 5 with runes, compiled via Vite. No SvelteKit — plain SPA with hash-based routing. No runtime framework deps ship to the browser.

## Table of Contents

- [Component Basics](#component-basics)
- [Runes](#runes)
- [Props](#props)
- [Snippets and Composition](#snippets-and-composition)
- [Event Handling](#event-handling)
- [Reactivity Patterns](#reactivity-patterns)
- [State Management](#state-management)
- [Data Fetching](#data-fetching)
- [Styling](#styling)
- [Naming](#naming)
- [Anti-Patterns](#anti-patterns)
- [References](#references)

## Component Basics

### File Structure

Components use `<script lang="ts">`, markup, then `<style>`:

```svelte
<script lang="ts">
  // 1. Imports (type-only first)
  import type { Snippet } from 'svelte';
  import type { SessionRow } from '../lib/types.ts';
  import { api } from '../lib/api.ts';
  import DataTable from '../components/DataTable.svelte';

  // 2. Props
  interface Props { ... }
  let { ... }: Props = $props();

  // 3. State
  let items: SessionRow[] = $state([]);
  let loading = $state(true);

  // 4. Derived values
  const isEmpty = $derived(items.length === 0);

  // 5. Effects
  $effect(() => { ... });

  // 6. Functions
  async function fetchData(): Promise<void> { ... }
</script>

<!-- markup -->

<style>
  /* scoped styles */
</style>
```

Every component must declare `lang="ts"`. Svelte components are default exports by nature (framework requirement). For all other modules (`.ts`, `.svelte.ts`), use named exports only.

## Runes

### `$state` for Mutable State

All mutable component state must use `$state()`. Plain `let` is not reactive in Svelte 5:

```typescript
let count = $state(0);
let items: string[] = $state([]);
let user: User | null = $state(null);
```

### `$derived` for Computed Values

Use `$derived` for values computed from other reactive state. Never use `$effect` to set derived values:

```typescript
const total = $derived(items.length);

// Complex logic — use $derived.by
const filtered = $derived.by(() => {
  if (!filter) return items;
  return items.filter((i) => i.name.includes(filter));
});

// WRONG — use $derived instead
let doubled = $state(0);
$effect(() => { doubled = count * 2; });
```

### `$effect` for Side Effects

Use `$effect` for DOM event listeners, timers, subscriptions, and data fetching. Always return a cleanup function when the effect creates resources:

```typescript
$effect(() => {
  const handler = () => { /* ... */ };
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
});
```

### `$effect` Dependencies are Automatic

Svelte tracks which reactive values are read **synchronously** in the effect body. Values read inside async callbacks, `setTimeout`, or `Promise.then` are not tracked. Capture values before the async boundary:

```typescript
// WRONG — statusFilter read inside async closure, not tracked
$effect(() => {
  const ac = new AbortController();
  fetchData(ac.signal); // reads statusFilter inside
  return () => ac.abort();
});

// CORRECT — read synchronously, pass as argument
$effect(() => {
  const filter = statusFilter; // tracked
  const ac = new AbortController();
  fetchData(filter, ac.signal);
  return () => ac.abort();
});
```

Use `$inspect(value)` during development for reactive logging (stripped in production).

## Props

### Interface-Typed `$props()`

Define a `Props` interface and destructure from `$props()`. Use `?` for optional props with defaults in destructuring:

```svelte
<script lang="ts">
  interface Props {
    label: string;
    value: string | number;
    variant?: 'info' | 'warning' | 'success' | 'error';
    onToggle?: () => void;
  }

  let { label, value, variant = 'info', onToggle }: Props = $props();
</script>
```

### Callback Props over Event Dispatchers

Svelte 5 replaces `createEventDispatcher` with callback props. Prefix callbacks with `on`:

```svelte
<script lang="ts">
  interface Props { active: boolean; onToggle: () => void; }
  let { active, onToggle }: Props = $props();
</script>

<button onclick={onToggle}>Toggle</button>
```

### `$bindable` for Two-Way Binding

Props that support `bind:` must use `$bindable()`:

```svelte
<script lang="ts">
  interface Props { value: string; }
  let { value = $bindable('') }: Props = $props();
</script>

<input bind:value />
```

## Snippets and Composition

Svelte 5 replaces `<slot>` with snippets. Use `?.()` for optional snippets:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    header?: Snippet;
    row?: Snippet<[item: Item, index: number]>;
  }

  let { children, header, row }: Props = $props();
</script>

{@render header?.()}
{@render children()}
```

Guard optional snippets with `{#if}` when wrapping in an element:

```svelte
{#if footer}
  <footer>{@render footer()}</footer>
{/if}
```

## Event Handling

### Use `onclick`, Not `on:click`

Svelte 5 uses standard HTML attribute syntax. Event modifiers are gone — handle in the function body:

```svelte
<script lang="ts">
  function handleSubmit(e: SubmitEvent): void {
    e.preventDefault();
  }
</script>

<button onclick={handleClick}>Click</button>
<button onclick={() => count++}>+</button>
<form onsubmit={handleSubmit}>...</form>
```

### Accessibility

Use semantic HTML — `<button>` for actions, `<a>` for navigation. Do not use `<div onclick>` for interactive elements. Non-button interactive elements need keyboard handlers and ARIA:

```svelte
<div
  role="switch"
  aria-checked={active}
  tabindex="0"
  onclick={onToggle}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  }}
></div>
```

Visual-only indicators need text alternatives via `title` or `aria-label`.

## Reactivity Patterns

### AbortController for Async Effects

Every effect that fetches data should use AbortController to prevent stale writes after unmount:

```typescript
$effect(() => {
  const ac = new AbortController();
  fetchData(ac.signal)
    .then((data) => {
      if (ac.signal.aborted) return;
      items = data;
    })
    .finally(() => {
      if (!ac.signal.aborted) loading = false;
    });
  return () => ac.abort();
});
```

### Auto-Refresh with Interval Cleanup

Combine data fetching with polling. The effect re-runs when tracked state changes:

```typescript
$effect(() => {
  const p = page; // tracked
  const ac = new AbortController();
  fetchPage(p, ac.signal);
  const timer = setInterval(() => fetchPage(p, ac.signal), 15_000);
  return () => { ac.abort(); clearInterval(timer); };
});
```

### Filter Changes Reset Page

When a filter changes, reset pagination. Use `bind:value` with an `onchange` handler:

```svelte
<script lang="ts">
  let statusFilter = $state('');
  let page = $state(1);
  function resetPage(): void { page = 1; }
</script>

<select bind:value={statusFilter} onchange={resetPage}>
  <option value="">All</option>
  <option value="active">Active</option>
</select>
```

## State Management

### Local State by Default

Each page component manages its own state. No global state store.

### Module-Level Reactive State in `.svelte.ts`

For state shared across components (like toast notifications), use `.svelte.ts` files with `$state`. The file extension must be `.svelte.ts` for runes to work outside components:

```typescript
// toast.svelte.ts
export let toasts: Toast[] = $state([]);

export function showToast(message: string, type: ToastType = 'info'): void {
  const id = nextId++;
  toasts.push({ id, message, type });
  timers.set(id, setTimeout(() => dismissToast(id), 4000));
}
```

Import and use directly — no prop drilling needed.

### SSE for Real-Time Data

Manage EventSource lifecycle in a dedicated module, not inline in components. Store listener references and clean up before closing:

```typescript
export function disconnectSSE(): void {
  if (eventSource) {
    if (statusListener) eventSource.removeEventListener('status', statusListener);
    eventSource.onerror = null;
    eventSource.onopen = null;
    eventSource.close();
    eventSource = null;
  }
}
```

## Data Fetching

### Typed API Wrapper

Use a generic `api<T>()` wrapper that handles auth headers and 401 responses:

```typescript
const data = await api<PaginatedResult<JobRow>>('/api/jobs?page=1&perPage=20');
```

### Pagination Pattern

Pages that list data use server-side pagination with `PaginatedResult<T>`. Track `page`, `totalPages`, `totalItems` as `$state`, pass to `DataTable` for controls:

```typescript
const PER_PAGE = 20;
let items: SessionRow[] = $state([]);
let page = $state(1);
let totalPages = $state(1);
let totalItems = $state(0);

async function fetchData(p: number, signal: AbortSignal): Promise<void> {
  const data = await api<PaginatedResult<SessionRow>>(
    `/api/sessions?page=${p}&perPage=${PER_PAGE}`,
  );
  if (signal.aborted) return;
  items = data.items;
  totalPages = data.totalPages;
  totalItems = data.totalItems;
}
```

### Parallel Fetches

When a page needs multiple API calls, use `Promise.all`:

```typescript
const [status, sessions, logs] = await Promise.all([
  api<StatusResponse>('/api/status'),
  api<PaginatedResult<SessionRow>>('/api/sessions?perPage=5'),
  api<PaginatedResult<LogRow>>('/api/logs?perPage=5'),
]);
```

## Styling

### Component-Scoped CSS

Write styles in `<style>` blocks. Svelte scopes them automatically. Reference CSS variables from `styles/global.css`, never hardcode colors or spacing:

```svelte
<style>
  .card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
</style>
```

### Global CSS Variables

Design tokens live in `styles/global.css` as custom properties:

```css
:root {
  --color-bg-deep: #0f1117;
  --color-accent: #60a5fa;
  --font-mono: 'JetBrains Mono', monospace;
  --radius-md: 6px;
  --transition-fast: 0.15s ease;
}
```

### `:global()` for Child Selectors

When a parent needs to style elements rendered by children:

```svelte
<style>
  .table :global(th) { font-weight: 600; }
</style>
```

### Directives

Use `class:name={condition}` for conditional classes and `style:prop={value}` for dynamic inline styles:

```svelte
<a class="nav-item" class:active={currentPage === item.page}>
<span style:color={connectionColor}>{status}</span>
```

## Naming

| Type | Convention | Example |
|------|-----------|---------|
| Page components | PascalCase | `Dashboard.svelte`, `Jobs.svelte` |
| Shared components | PascalCase, descriptive | `DataTable.svelte`, `StatCard.svelte` |
| Utility modules | camelCase | `api.ts`, `format.ts` |
| Reactive modules | camelCase `.svelte.ts` | `toast.svelte.ts` |
| Props | camelCase, `on`-prefixed callbacks | `onPageChange`, `isEmpty` |

## Anti-Patterns

1. **`let` without `$state()`** — variables are not reactive without it
2. **`$effect` for derived values** — use `$derived` instead
3. **`on:click` syntax** — use `onclick` (Svelte 5)
4. **`createEventDispatcher`** — use callback props
5. **`<slot>`** — use snippets with `{@render}`
6. **Reactive state read inside async closures in effects** — capture synchronously first
7. **Missing cleanup in `$effect`** — always return cleanup for timers, listeners, AbortControllers
8. **State mutation after unmount** — check `signal.aborted` before writing
9. **`export let` for props** — use `$props()` (Svelte 5)
10. **Stores (`writable`, `readable`)** — use `$state` in `.svelte.ts` modules

## References

- [Svelte 5 Documentation](https://svelte.dev/docs/svelte)

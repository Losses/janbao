# DV20 Cycle 2 Spec: Unified PageCacheStore

**Architect:** the document owner. **Executor:** the Cycle 2 Manager Agent (CMA2). **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md` (v2, binding). **Status:** pending Cycle 1 close.

## Scope

Replace the four cache singletons (`list-cache`, `deep-page-snapshot`, `page-scroll`, `search-cache`) with one unified `PageCacheStore`. The store is keyed by `(pathname, subKey)`, value `{data, snippet?, scrollTop, source, capturedAt}`. Single `capture`/`get`/`invalidate`. The read interface is data-source-agnostic (a pluggable source) so Cycle 6 can plug in IndexedDB for the offline routes. SvelteKit's `snapshot` exports are retained for cross-reload restoration (orthogonal to this session-scoped store).

## Background

- `docs/DV20-Plan.md` §7 (the PageCacheStore shape), §11 (the Cycle Manager protocol v2), §13 (values).
- The current cache stores (from the Cycle 1 research): `list-cache.svelte.ts` (3 tab-list slots, keyed by labelKey), `deep-page-snapshot.svelte.ts` (1 slot, last-captured-only, holds a Snippet), `page-scroll.svelte.ts` (path-keyed map of scroll positions), `search-cache.svelte.ts` (4 scope slots, query-stale). All module singletons. Each has different keys, value shapes, invalidation rules, and reader contracts. The research documented 10 cache-related bugs.

## End state (the WHAT; the HOW is the CMA's to determine)

1. A single `PageCacheStore` exists, replacing all four singletons. Keyed by `(pathname, subKey)`. Value: `{data, snippet?, scrollTop, source, capturedAt}`. The entry's type (tab-list / thread / search-scope / deep) is derived from `source.route` via the `RouteData` record (from Cycle 1), NOT stored as a `discriminator`.
2. One writer (`capture`), one reader (`get`), one invalidation rule (source-tag mismatch + TTL eviction for the unbounded `page-scroll` growth).
3. The read interface is data-source-agnostic: the store reads page data via a pluggable source (the default reads from page data / IDB for offline). This enables Cycle 6 without changing the store.
4. All four existing stores' callers migrated to the unified store. The callers include: the root-layout `$effect` that feeds list-cache, the thread page's `beforeNavigate` that captures deep-page-snapshot, the four `onscroll` handlers that capture page-scroll, the SearchScopePager's `$effect` that captures search-cache, the GesturePageLayout/MobileTabPager reads for back-swipe preview, and the scroll-restore reads.
5. Behavior identical to the current codebase.

## Constraints

- Behavior-preserving. The existing e2e suite passes.
- The store must be a module singleton (mirroring the existing pattern). No `getContext`/`setContext` for the store itself (the consumer is an ancestor of the writers).
- The `snippet` field holds a Svelte `Snippet` closure (non-serializable); the store must handle its lifetime correctly (the snippet is captured before the producing page unmounts; this invariant is unchanged from the current deep-page-snapshot).
- SvelteKit `snapshot` exports stay (cross-reload restoration, orthogonal).
- No git mutation.

## Out of scope

- The state machine, resolvers, executor, lifecycle. Those are Cycles 3-5.
- The offline IDB integration (Cycle 6). The pluggable source interface is designed here but the IDB source lands in Cycle 6.

## CMA protocol (v2)

Per `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`:

- The CMA implements, writes the journal, reports. Does NOT run the audit.
- The orchestrator runs the audit (2-per-round x 5-vote convergence, clean non-leading prompts).
- Anti-fabrication, no git mutation, journal honest.

## Deliverables

- The unified `PageCacheStore` (in `src/lib/stores/`).
- Migrated callers.
- Unit tests (the store's capture/get/invalidate; the pluggable source).
- `docs/DV20-C02-Journal.md` (incremental, honest, real evidence pasted).
- The Coverage bullets round-independent from the start (point to the audit files).

## What the architect will check at review

- Is the store the single replacement for all four singletons?
- Is the read interface data-source-agnostic (pluggable source)?
- Is behavior identical (the e2e evidence)?
- Is the journal honest?
- Did the audit reach 5 consecutive pass votes with clean prompts?

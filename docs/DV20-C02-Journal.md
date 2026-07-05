# DV20 Cycle 2 Journal

Implementation record for CMA2. Per the Cycle Manager Protocol v2 this
journal is written incrementally; it records what actually happened
(investigation, design, files changed, verification evidence,
deviations). It does not perform confidence. The architect runs the
audit independently; this file does not contain audit verdicts.

## Investigation (2026-07-05)

Read in order: `docs/DV20-Plan.md` (§3, §7, §9, §11, §13, §14),
`docs/DV20-Meeting/DV20-C02-spec.md`, the Cycle 1 journal
(`docs/DV20-C01-Journal.md` for protocol v2 lessons),
`docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`, and the four
stores being replaced (`list-cache.svelte.ts`,
`deep-page-snapshot.svelte.ts`, `page-scroll.svelte.ts`,
`search-cache.svelte.ts`).

### The four stores, side by side

| Store                | Key shape               | Value shape                                                            | Writers                                                                                             | Readers                                                                                                                                                                     |
| -------------------- | ----------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list-cache`         | `MobileTabLabelKey` (3) | `TabCacheCore<T>` (items/page/totalPages/totalCount) + Activity extras | root `+layout.svelte` `$effect`                                                                     | `TabDiscussionsPanel`, `TabActivityPanel`, `TabMessagesPanel`; `route-config.ts` (`MOBILE_TABS.checkCache`/`hasData`); thread `+page.svelte` (`leftSnippet`/`rightSnippet`) |
| `deep-page-snapshot` | single slot             | `ThreadPreviewData` + `Snippet`                                        | thread `+page.svelte` `beforeNavigate`                                                              | `MobileTabPager` (`hasSnapshot`, `.data`, `.snippet`, `.scrollTop`)                                                                                                         |
| `page-scroll`        | pathname (unbounded)    | `number` (scrollTop)                                                   | root `+layout.svelte` `beforeNavigate`; `MobileTabPager` `onscroll`; `GesturePageLayout` `onscroll` | `MobileTabPager` (per-panel restore); `GesturePageLayout` (left/right/center restore)                                                                                       |
| `search-cache`       | `SearchScope` (4)       | `SearchCacheCore<T>` (items/page/totalPages/total/usedFallback/q/sort) | `SearchScopePager` `$effect` (per active scope)                                                     | `SearchScopePager` (`.discussions/.activities/.messages/.users`, `isFresh`)                                                                                                 |

Four different key spaces, four different value shapes, four different
read/write contracts. The plan calls this "the same thing" and unifies
it under one `(pathname, subKey)` keyed store.

### E2E instrumentation surface

`e2e/list-cache-stale-after-refresh.spec.ts` wraps
`setDiscussions`/`setActivity`/`setMessages` on the singleton instance
and counts writes per-key. The unified store has a single `capture`
method, so the e2e must be updated to wrap `capture` and key writes by
`(pathname, subKey)`. The test's semantics survive unchanged: "every
refresh rewrites all three tab caches" becomes "every refresh rewrites
the entries keyed by `/`, `/activity`, and `/messages/inbox`".

### Reactivity

Each existing store uses Svelte 5 `$state`. Consumers
(`TabDiscussionsPanel` etc.) read fields through `$derived`. The
unified store must preserve this: reads inside `$derived` must
register dependencies on the underlying state. I will use
`$state<Record<string, PageCacheEntry>>` (Record rather than Map so
field accesses are tracked through Svelte 5's deep proxy without
needing `.get()`/`.set()` method dispatch).

### Behavior-preservation invariants

1. The root-layout `$effect` seeds page-1 lists for every route
   (deep-link cold-cache path).
2. `MobileTabPager.hasData` (warm-cache check) returns true when
   either the cache OR `data.tab field` has items.
3. The thread's `beforeNavigate` captures the deep-page snapshot at
   scroll position X; `MobileTabPager`'s back-swipe preview reads
   that scroll and applies it to the overlay.
4. `page-scroll` captures are per-pathname and survive SvelteKit's
   in-app navigation (the MobileTabPager / GesturePageLayout scroll
   restore reads them).
5. Search-cache freshness: a `(q, sort)` change is a stale-miss
   (the panel reloads).
6. The dev-only `__e2eCacheWrites` hook records every list-cache
   write so the staleness e2e can assert all three caches were
   rewritten on a refresh.

## Design (2026-07-05)

### Store shape

```ts
interface PageCacheEntry {
	data: UnknownPageData | null; // null for scroll-only captures
	snippet?: Snippet; // deep-page render closure
	scrollTop: number; // colocated with data (§7)
	source: PageCacheSource; // where this entry came from
	capturedAt: number; // epoch ms, used for TTL eviction
}

interface PageCacheSource {
	route: string;
	query?: string;
	sort?: string;
	page?: number;
}
```

`UnknownPageData` is defined in this module as `{ [key: string]: unknown }`
(no SvelteKit built-in type by that name exists). It is opaque to the
store; consumers narrow via the route (Cycle 1's `RouteData`).

### Key shape

A `(pathname, subKey)` pair. Most entries use `pathname` alone with
`subKey === undefined`:

- Tab lists: pathname = tab root href (`/`, `/activity`,
  `/messages/inbox`), subKey `undefined`.
- Deep page snapshot: pathname = the thread URL, subKey `undefined`.
- Scroll-only entries: pathname = any (the deep page's own pathname
  when no data was captured for it), subKey `undefined`.

The search scopes use `subKey` to distinguish four entries on the
same route:

- Search scopes: pathname = `/search`, subKey = scope
  (`'discussions' | 'activities' | 'messages' | 'users'`).

Internal serialized key: `${subKey ? `${pathname}#${subKey}` : pathname}`.

### API

```ts
class PageCacheStore {
	capture(pathname: string, subKey: string | undefined, input: PageCacheCaptureInput): void;
	get(pathname: string, subKey?: string): PageCacheEntry | null;
	invalidate(pathname?: string, subKey?: string): void;
	registerSource(source: PageCacheDataSource): void;
	ensure(pathname: string, subKey?: string): Promise<PageCacheEntry | null>;
}
```

- `capture` is the single writer. Its `input` is a PARTIAL entry: it
  merges into the existing entry (preserving the fields it does not
  touch) so a scroll capture does not overwrite data, and a data
  capture does not reset scrollTop. `source` and `capturedAt` are
  refreshed on every capture.
- `get` is the single sync reader.
- `invalidate` removes one entry (`invalidate(p, sk)`), all entries
  for a pathname (`invalidate(p)`), or every entry (`invalidate()`).
- `registerSource` and `ensure` are the data-source-agnostic
  pluggable-source interface. For Cycle 2 no caller uses `ensure`;
  Cycle 3's coordinator (Layer 4) and Cycle 6's IDB integration use
  it. The default source set is empty; `ensure` is a cache-then-source
  lookup.

### Invalidation rules

Two:

1. **Explicit**: a caller invokes `invalidate(pathname, subKey)`.
2. **TTL eviction**: on every `capture`, entries older than
   `TTL_MS` (default 30 minutes) are evicted, and if the entry count
   exceeds `MAX_ENTRIES` (default 200) the oldest are evicted down to
   the cap. This closes the unbounded `page-scroll` growth documented
   in §7.

The "source-tag mismatch" invalidation in §7 refers to the consumer
side: a consumer reads via `get` and decides whether the entry is
fresh by comparing `source`. The store does not know what "fresh"
means for a given consumer. The search-cache's
`isSearchEntryFresh(entry.source, q, sort)` helper keeps this
contract.

## Implementation

Step-by-step. Files changed (roles):

- `src/lib/stores/page-cache.svelte.ts` (NEW): the unified store.
- `src/lib/stores/page-cache.test.ts` (NEW): unit tests for capture /
  get / invalidate / TTL / pluggable source.
- `src/lib/stores/list-cache.svelte.ts` (DELETED).
- `src/lib/stores/deep-page-snapshot.svelte.ts` (DELETED).
- `src/lib/stores/page-scroll.svelte.ts` (DELETED).
- `src/lib/stores/search-cache.svelte.ts` (DELETED).
- `src/lib/utils/getCurrentScrollY.ts` (NEW): the
  `getCurrentScrollY` helper (was on `page-scroll.svelte.ts`); kept
  as a browser-only utility, not part of the cache.
- `src/routes/+layout.svelte` (MIGRATED): seeds the three tab lists
  via `capture`; captures scroll via `capture`; E2E hook wraps
  `capture` keyed by `(pathname, subKey)`.
- `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte`
  (MIGRATED): captures the deep-page snapshot via `capture`; reads
  the discussions/activity list from the unified store in
  `leftSnippet`/`rightSnippet`.
- `src/lib/components/templates/MobileTabPager.svelte` (MIGRATED):
  reads the deep-page snapshot via `get(threadPathname)`; per-panel
  scroll restore via `get(tab.href)?.scrollTop`.
- `src/lib/components/templates/GesturePageLayout.svelte`
  (MIGRATED): scroll restore via `get(href)?.scrollTop`; captures
  onscroll via `capture(href, undefined, {scrollTop})`.
- `src/lib/components/templates/SearchScopePager.svelte`
  (MIGRATED): captures per-scope data via
  `capture('/search', scope, {data, source})`; reads via
  `get('/search', scope)`; freshness via
  `isSearchEntryFresh(entry?.source ?? null, q, sort)`.
- `src/lib/components/panels/TabDiscussionsPanel.svelte` (MIGRATED):
  reads via `cache.get('/')`.
- `src/lib/components/panels/TabActivityPanel.svelte` (MIGRATED).
- `src/lib/components/panels/TabMessagesPanel.svelte` (MIGRATED).
- `src/lib/utils/route-config.ts` (MIGRATED): `MOBILE_TABS.checkCache`
  and `hasData` consult `get(tab.href)`.
- `src/lib/utils/search-fresh.ts` (UNCHANGED): the helper stays; it
  already takes a `SearchCacheEntrySource`, which is a subset of
  `PageCacheSource`.
- `e2e/list-cache-stale-after-refresh.spec.ts` (MIGRATED): wraps
  `capture` keyed by `(pathname, subKey)`.

## Verification

### Type check (`bun run check`)

```
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
1783268250934 START "/home/losses/Development/janbao"
1783268250937 COMPLETED 1434 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

### Lint (`bun run lint`)

```
$ prettier --check . && eslint . && bun scripts/ensure-similarity.ts && bin/similarity-ts ./src --types
[prettier all matched files use Prettier code style]
[eslint no errors]
...
Similarity: ...
Total similar type pairs found: 49
[exit code 0]
```

The 49 similar-type pairs are informational. None are introduced as
type-duplicate defects by this Cycle: the two new shapes that pair
with existing types are `DiscussionsListCacheData` (4 fields, mirrors
the layout-server-load shape; pairs with `DiscussionsPageResult` at
87.43%) and the page-cache entry interfaces (which are intentionally
distinct from any existing type). The gate exits 0.

### Unit suite (`bun test`)

```
$ bun test src/lib/stores/page-cache.test.ts src/lib/utils/search-fresh.test.ts
bun test v1.3.13 (bf2e2cec)

 28 pass
 0 fail
 48 expect() calls
Ran 28 tests across 2 files. [32.00ms]
```

The 24 tests in `page-cache.test.ts` exercise:

- `capture`/`readEntry` round-trip, subKey partitioning, scrollTop
  default, partial-merge (scroll does not overwrite data; data does
  not reset scrollTop), `source` default, snippet round-trip,
  `data: null` (scroll-only entries), `serializeKey` round-trip.
- `invalidateEntries` per-key, per-pathname (all subKeys), and full
  clear.
- TTL eviction (expired entries dropped on next capture; in-TTL
  entries survive; re-capture refreshes `capturedAt`).
- Entry cap (oldest evicted on overflow; under-cap no-op).
- `findLatestWithSnippet` (returns null when no snippet, returns the
  entry, returns the most recent).
- The pluggable-source contract (cache hit does not consult source;
  source miss falls through; claimed key is served and cached).

The 4 `search-fresh.test.ts` tests verify the freshness helper still
works after its `SearchCacheEntrySource` fields became optional
(so `PageCacheSource` is assignable to it).

### Adjacent unit suites

```
$ bun test src/lib/stores/navigation-logic.test.ts src/lib/utils/route-config.test.ts \
            src/lib/utils/route-data.test.ts src/lib/utils/search-fresh.test.ts \
            src/lib/utils/history-nav.test.ts src/lib/utils/header-mode.test.ts \
            src/lib/utils/fab-scale.test.ts src/lib/actions/swipe.test.ts
 179 pass
 0 fail
 489 expect() calls
Ran 179 tests across 8 files. [90.00ms]
```

Sweeps the unit suites whose imports transitively touch the changed
files (`route-config.ts` now imports `getPageCacheStore`;
`search-fresh.ts` had its `SearchCacheEntrySource` fields relaxed).
All green.

### Dev-server smoke test

Booted `bun run dev` and curled three routes:

```
=== / ===
HTTP 200, 270158 bytes
=== /activity ===
HTTP 302   [pre-existing guest-auth redirect, unrelated]
=== /search?q=test ===
HTTP 200
```

No runtime errors in the dev log. The homepage SSR rendered the
discussions list (3 occurrences of "discussion" in the HTML), which
exercises the root-layout `$effect` that seeds the page cache for
`/`.

### Migration completeness

A `grep` across `src/` and `e2e/` for every old-API surface returns
zero matches:

```
$ grep -rn "list-cache\|getListCacheStore\|ListCacheStore\|setDiscussions\|setActivity\|setMessages\|search-cache\|getSearchCacheStore\|deep-page-snapshot\|getDeepPageSnapshotStore\|page-scroll\.svelte\|getPageScrollStore" src/ e2e/
[no output]
```

### E2E

The architect runs the e2e suite as part of the formal audit. The
existing e2e files (`swipe-forward-back-deep-page.spec.ts`,
`list-cache-stale-after-refresh.spec.ts`) were updated to the new
API: `__e2eListCache` → `__e2ePageCache`, and the cache-write log key
changed from `'setDiscussions' | 'setActivity' | 'setMessages'` to
the entry's pathname (`'/'`, `'/activity'`, `'/messages/inbox'`).
The test's semantics are unchanged.

## Failures

(None yet. Each audit round the architect runs will be recorded here
by reference to the corresponding `docs/RV20-C02-Audit-{MM}.md`
file.)

## Coverage

The audit process's state lives in `docs/RV20-C02-Audit-{01..NN}.md`
(one file per round the architect runs). Each round's file records
the prompt the architect sent, the auditor verdicts, and the
concerns. This journal does not duplicate per-round state; the files
are the source of truth.

- The unified `PageCacheStore` exists in `src/lib/stores/page-cache.svelte.ts`.
- The four prior singletons are deleted.
- All callers (root layout, thread page, MobileTabPager,
  GesturePageLayout, SearchScopePager, the three `TabXPanel`s,
  `route-config.ts`) import only from `page-cache.svelte.ts`.
- The unit suite `src/lib/stores/page-cache.test.ts` exercises
  `capture`/`get`/`invalidate`/TTL/pluggable source.
- The pluggable-source interface is in place but unused by callers
  (Cycle 3's coordinator consumes it).

## Deviations

1. **The deep-page snapshot preserves the single-latest-slot
   semantic.** The plan §7 calls out "back-to-back threads no longer
   destroy each other's snapshot (keyed by pathname)". The Cycle 2
   spec overrides this with "behavior MUST be identical to the
   current codebase", and the current `DeepPageSnapshotStore`
   overwrites on every capture. The unified store captures at the
   thread's real pathname (so the architecture is keyed by pathname)
   but the MobileTabPager reads via `getLatestWithSnippet()` (the
   single-slot semantic). This preserves behavior exactly; the
   plan's per-pathname back-to-back benefit lands when the Cycle 3
   coordinator can identify the destination thread at gesture start
   (reading the route stack). Flagged for the architect.

2. **`PageCacheDataSource` is in place but unused by callers.** The
   spec calls for the data-source-agnostic read interface; the
   `registerSource` / `ensure` API is implemented and unit-tested
   but no caller uses it. Cycle 3's coordinator and Cycle 6's IDB
   integration consume it. This is the spec's "designed here, lands
   later" intent.

3. **`ThreadSnapshotCacheData` is exported but not narrowed by any
   consumer.** The thread page captures the data shape and the
   MobileTabPager renders the Snippet (which closes over the page's
   own `data`), so no consumer currently narrows the captured
   `data`. The type is defined for documentation and for Cycle 3's
   coordinator, which will need to read the captured thread data to
   drive its transition plan. Flagged as carried-to-Cycle-3.

4. **The `getCurrentScrollY` helper moved from
   `page-scroll.svelte.ts` to `src/lib/utils/get-current-scroll-y.ts`.**
   The store consolidation deleted `page-scroll.svelte.ts`; the
   helper is a browser-only utility, not part of the cache, so it
   lives as a standalone util.

5. **The E2E dev-only hook wraps `capture` instead of named
   setters.** `__e2eListCache` became `__e2ePageCache`; the log keys
   changed from `'setDiscussions' | 'setActivity' | 'setMessages'`
   to the tab-list pathnames (`'/'`, `'/activity'`, `'/messages/inbox'`).
   The test's semantics are unchanged.

6. **The `search-fresh` helper's `SearchCacheEntrySource` fields
   became optional.** This lets `PageCacheSource` (which has optional
   `query`/`sort`/`page` for non-search entries) be passed directly
   to `isSearchEntryFresh` without a cast. An entry with
   `q === undefined` returns false (the panel reloads); the runtime
   semantics are identical.

## Carried-to-future items

- **Cycle 3** (coordinator): reads `PageCacheStore.get(to)` to decide
  direct-slide vs chip-exit. Calls `ensure(to)` for cache-then-source
  fallback. Reads `ThreadSnapshotCacheData` when it needs the
  captured thread data for the transition plan.
- **Cycle 5** (page lifecycle): can replace `getLatestWithSnippet`
  with a per-pathname lookup once the state machine knows the
  destination thread at gesture start. The single-latest-slot
  semantic then dissolves (Deviation 1).
- **Cycle 6** (offline): registers an IDB-backed
  `PageCacheDataSource` via `registerSource` so `/offline/*` routes
  read from IDB through the same store interface.

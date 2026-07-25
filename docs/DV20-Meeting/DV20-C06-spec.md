# DV20 Cycle 6 Spec: Offline Unification

**Architect:** the document owner. **Executor:** the Cycle 6 Manager Agent
(CMA6). **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`.
**Status:** ready for development. **Depends on:** Cycles 1 to 5b2 (all
complete and 5/5-converged).

## Scope

Bring the four `/offline/*` reader routes into the unified gesture /
navigation / cache layer built in Cycles 1 to 5b2. After Cycle 6 every mobile
route in the app (online and offline) uses the new pipeline as its sole
horizontal-gesture / back-swipe mechanism, and the data-source-agnostic
`PageCacheStore` has its first non-trivial registered source (an IDB-backed
one) so the offline reader's IDB reads flow through the same cache interface
the online routes use.

### Routes to migrate

- `/offline` (mirror of `/`, the offline discussions list). `tag: 'tab'`.
- `/offline/activity` (mirror of `/activity`). `tag: 'tab'`.
- `/offline/bookmarks` (mirror of `/bookmarks`). `tag: 'detail'`.
- `/offline/[discussionId]` (mirror of the discussion thread). `tag: 'detail'`.

The `RouteData` tags are already correct in `src/lib/utils/route-data.ts`
(Cycle 1 placed them). The `TAB_BAR_CONFIG` entries that assign their
`pillTarget` are also already in place. Cycle 6 wires these routes into the
pipeline host + the `isNavPipelineRoute` gate + the `PageCacheStore`'s source
registry.

## End state

1. Each of the four `/offline/*` routes mounts `NavPipelineHost` inside its
   existing `DualColumnLayout` shell, matching how `/bookmarks` already
   composes `DualColumnLayout` (desktop shell + drawer) with `NavPipelineHost`
   (mobile gesture pipeline). `DualColumnLayout` is NOT removed (the desktop
   shell + the mobile drawer remain its responsibility; C05b2 known #2 records
   that deletion as out of scope).
2. `isNavPipelineRoute` returns `true` for `/offline`, `/offline/activity`,
   `/offline/bookmarks`, and `/offline/[discussionId]` (numeric id only, mirroring
   the online thread gate). The orchestrator + the layout hooks treat these
   pathnames as pipeline routes for the rest of the app's lifetime.
3. An IDB-backed `PageCacheDataSource` is registered with the singleton
   `PageCacheStore`. The source owns the three offline LIST pathnames
   (`/offline`, `/offline/activity`, `/offline/bookmarks`). Its `read` calls the
   existing `loadOfflineDiscussions` / `loadOfflineActivity` /
   `loadOfflineBookmarks` helpers from `$lib/offline/queries` (the same IDB
   reads the routes do today, wrapped not replaced).
4. The three offline LIST route components read their IDB data through
   `pageCache.ensure(pathname, undefined)` instead of calling the IDB helpers
   directly. The unified cache is the sole read path; the IDB source is the
   cache's backing source.
5. The offline thread route `/offline/[discussionId]` is unchanged in its data
   path (its `+page.ts` already runs `ssr = false` and reads IDB in `load`); it
   only gains the `NavPipelineHost` wrapper so the back-swipe to `/offline`
   runs through the pipeline.
6. The list-to-detail transitions `/offline` -> `/offline/[id]` and
   `/offline/bookmarks` -> `/offline/[id]` use the existing `{tab, detail}` and
   `{detail, detail}` resolver pairs (Cycle 3) verbatim. No offline-specific
   resolver edges are added.
7. The `RouteData.fab` booleans stay `false` on every offline route (the
   offline reader shows no FAB; offline is read-only). The
   `FAB_ROUTE_ATTRIBUTES` table is NOT extended for the offline routes (the FAB
   atom does not mount on them).
8. The back-swipe LEFT preview for an offline back-target (`/offline` revealed
   by a back-swipe from `/offline/bookmarks` or `/offline/[id]`) falls through
   to `<DeepPreviewSkeleton />`, matching every other deep back-target without
   a registered preview panel (e.g. `/bookmarks`, `/notifications`). Registering
   a dedicated offline preview panel is out of scope for this cycle.

## File-level changes

### `src/lib/utils/nav-pipeline-gate.ts`

Add four matches to `isNavPipelineRoute` (before the final `return false`):

- `pathname === '/offline'`
- `pathname === '/offline/activity'`
- `pathname === '/offline/bookmarks'`
- `/^\/offline\/\d+$/.test(pathname)` (offline thread; numeric id only, mirroring
  the online thread gate's strict shape)

The `?search` strip and the `/pN` strip at the top of the function already
cover any query / page suffix an offline URL might carry.

### `src/lib/offline/offline-page-cache-source.ts` (new)

A new module that exports the IDB-backed source and an idempotent
`registerOfflinePageCacheSource()` helper. The source's
`isResponsibleFor(pathname)` returns true for the three offline LIST pathnames;
its `read(pathname)` delegates to the existing IDB loaders in
`$lib/offline/queries`. The module calls `registerOfflinePageCacheSource()`
eagerly at module load (idempotent via a module-level `registered` flag), so
the first import from any offline route component registers the source before
the route's `onMount` calls `ensure`.

The module is client-only-safe at registration time: registering the source
just pushes an object onto the singleton store's `#sources` array; no Dexie
code runs until `read` is actually called from a client-side `onMount`. SSR
importing the module (transitively, via the offline route components) is safe;
SSR never calls `ensure` (no `onMount` runs on the server).

### `src/routes/offline/+page.svelte`

- Wrap the existing content block in `<NavPipelineHost leftHref="/">`.
- Replace the direct `loadOfflineDiscussions()` call in `onMount` with a
  `pageCache.ensure(page.url.pathname, undefined)` call; cast the entry's
  `data` to `OfflineDiscussionView[] | null`.
- Import `registerOfflinePageCacheSource` and call it at module top-level
  (idempotent; ensures the source is registered before the first `ensure`).

### `src/routes/offline/activity/+page.svelte`

Same shape as `/offline`: wrap in `<NavPipelineHost leftHref="/activity">`,
read via `pageCache.ensure`, register the source.

### `src/routes/offline/bookmarks/+page.svelte`

Same shape, with `leftHref="/offline"` (the offline discussions list is the
back-target inside the offline reader's own tree).

### `src/routes/offline/[discussionId]/+page.svelte`

- Wrap the existing content block in
  `<NavPipelineHost leftHref="/offline" centerTab={0}>`.
- The `+page.ts` (which carries `ssr = false` and reads IDB in `load`) is
  unchanged. The route's data path is already correct; only the gesture host
  is added.

### `src/lib/utils/nav-pipeline-gate.test.ts`

Extend the suite with the offline pathnames (positive + a negative for the
non-numeric `/offline/<slug>` shape that should not match).

### `src/lib/stores/page-cache.test.ts` (or a sibling suite)

Add a unit test that exercises the
`isResponsibleFor` + `read` contract of the new source (the existing
`pluggable source contract` block already documents the shape; the new test
asserts the offline source implements it).

## Constraints

- **UNIFY, DO NOT BRIDGE (binding).** Each offline route's horizontal gesture
  is the new pipeline. The `DualColumnLayout` shell remains as the desktop
  shell + the mobile drawer host; its drawer gesture (`captureSwipe`) is a
  UI gesture, not a page-transition mechanism, and is retained (C05b2 known #2).
- **Do NOT break the online routes.** The 24 deep + 3 compose + thread + 3 tab
  roots + `/discussions/pN` routes that already mount a pipeline host must
  work identically. The full 210-test e2e suite is the regression gate.
- **Do NOT break the offline reader (DV06/DV07).** The IDB reads
  (`loadOfflineDiscussions`, `loadOfflineActivity`, `loadOfflineBookmarks`)
  continue to work; the cache source wraps them, not replaces them. The
  `/offline/[discussionId]/+page.ts` load function is unchanged.
- **No git mutation** by the CMA.
- **Comment-accuracy + clean-prompt audit.** Every code comment in the touched
  files describes current behavior (no formerly / old / previously markers).
  After every `.md` / code-comment edit, run `grep -P '\x{2014}' <file>` (no
  em dashes) and `bunx prettier --check <file>`.
- **Flakies are defects.** A flaky e2e is root-caused, not retried; the gate
  requires zero flakies.

## Migration order

1. `nav-pipeline-gate.ts` + its unit tests (low risk, prepares the gate).
2. The new `offline-page-cache-source.ts` + its unit test.
3. The three offline LIST route components (`/offline`, `/offline/activity`,
   `/offline/bookmarks`): wrap in `NavPipelineHost`, route data through
   `pageCache.ensure`, register the source.
4. The offline thread route `/offline/[discussionId]`: wrap in
   `NavPipelineHost` (no data-path change).
5. Run the full gate (`bun run check`, `bun run lint`, `bun run test:e2e`).

## Test plan

- Unit: `nav-pipeline-gate.test.ts` covers the four new pathnames; a negative
  case for `/offline/<non-numeric>` (must not gate).
- Unit: the offline source's `isResponsibleFor` / `read` contract (mocking the
  IDB loaders).
- E2E (regression): the full 210-test suite. The offline reader's existing
  behavior (DV06/DV07) is covered by `e2e/mobile-passthrough.spec.ts` and
  related specs; they must remain green.

## Out of scope

- Deleting `DualColumnLayout` (C05b2 known #2; the desktop shell + the mobile
  drawer host stay).
- Registering a dedicated preview panel for `/offline` so the back-swipe
  LEFT preview shows real content instead of `<DeepPreviewSkeleton />`. The
  skeleton fallback matches every other deep back-target without a registered
  panel; a real-content preview is a follow-on enhancement, not a Cycle 6
  requirement.
- Extending `FAB_ROUTE_ATTRIBUTES` for the offline routes (no offline route
  shows a FAB).
- Adding new e2e specs that gesture-swipe within `/offline/*`. The existing
  e2e suite already covers the gesture pipeline's invariant behavior on the
  online routes; the offline routes use the same resolver pairs and the same
  host, so the regression sweep is the gate.

## Deliverables

- The gate change (`isNavPipelineRoute`).
- The new IDB-backed `PageCacheDataSource` and its registration.
- The four offline route components mounting `NavPipelineHost`.
- The three offline LIST route components reading through `pageCache.ensure`.
- Unit tests for the gate + the source.
- `docs/DV20-C06-Journal.md` (the implementation journal, incremental and
  honest).
- A green gate: `bun run check` 0 errors, `bun run lint` exit 0, full
  `bun run test:e2e` zero failures / zero flakies.

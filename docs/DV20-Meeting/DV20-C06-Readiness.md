# DV20 Cycle 6 Readiness - Offline Unification

**Date:** 2026-07-24. **Context:** DV20-C05b2 converged at 5/5 (R135). Per
`docs/DV20-Plan.md` §11, the next development cycle is **Cycle 6: Offline
unification** (the Final cycle; depends on Cycles 1 to 5, all complete). This note
inventories the current state so the architect can write the Cycle 6 spec. It is
NOT the spec (the architect owns each Cycle spec, per the DV20 execution model).

## What Cycle 6 does (plan §11)

Bring the `/offline/*` routes into the unified gesture / navigation / cache layer:
mount the state-driven track (`NavPipelineHost`) on the offline routes; plug IndexedDB
into the data-source-agnostic cache interface; give the offline routes `RouteData`
records mirroring their online counterparts; remove `DualColumnLayout` from them. The
offline list-to-detail transitions (`/offline` to `/offline/[id]`) use the gesture
layer like their online counterparts.

## Current state (read-only inventory)

- Offline routes (4): `/offline` (mirror of `/`), `/offline/activity` (mirror of
  `/activity`), `/offline/bookmarks` (mirror of `/bookmarks`), `/offline/[discussionId]`
  (mirror of the discussion thread). All four render via `DualColumnLayout` directly
  today; none mount `NavPipelineHost`.
- `isNavPipelineRoute` (`src/lib/utils/nav-pipeline-gate.ts`) does NOT include any
  `/offline/*` route (offline is out of the pipeline today).
- `route-data.ts` already tags the offline routes: `/offline` and `/offline/activity`
  are `tag: 'tab'` (mirror tab roots); `/offline/bookmarks` and `/offline/[discussionId]`
  are `tag: 'detail'` (mirror detail pages). The taxonomy is in place; Cycle 6 wires
  them into the pipeline host + the `isNavPipelineRoute` gate.
- The `PageCacheStore` read interface is data-source-agnostic by design
  (`src/lib/stores/page-cache.svelte.ts`): a pluggable `PageCacheDataSource` can be
  registered, and `ensure(pathname, subKey)` does a cache-then-source lookup. The
  default source set is empty today (no integrated caller uses `ensure`); Cycle 2
  left this hook specifically so Cycle 6 can register an IDB-backed source for the
  offline routes.
- The offline routes read IndexedDB directly today (the offline reader, DV06/DV07);
  Cycle 6 routes that data through the cache interface instead.

## What a Cycle 6 spec needs to decide (architect)

- The IDB `PageCacheDataSource` shape (key, value, how it mirrors the online cache
  entries) and where it is registered (offline-reader load vs. a dedicated offline
  cache source).
- Whether the offline list-to-detail gesture reuses the online `{tab, tab}` /
  `{detail, detail}` resolvers verbatim or needs offline-specific edges (the offline
  detail has no back-target in the online stack sense; it is IDB-sourced).
- The `backParent` / centerTab wiring for the offline detail mirror (the online
  thread uses `centerTab`; the offline thread mirrors it).
- Migration scope + order (which offline route first as the pilot; full e2e at each
  step, per the C05b2 precedent).
- Whether DualColumnLayout is fully removed from the offline routes on mobile (it is
  the last DualColumnLayout mobile usage; plan §9 says DualColumnLayout dissolves
  completely once offline is unified).

## Gate baseline (Cycle 6 starts from green)

DV20-C05b2 leaves the gate green: `bun run check` 0 errors / 0 warnings (1467
files); `bun run lint` exit 0; FULL e2e 210 passed / 0 flaky (R132, independently
re-verified; R133 to R135 made no code changes). Cycle 6's CMA inherits this
baseline.

## Out of scope for this note

Writing the Cycle 6 spec, implementing it, or running its audit loop. Those begin
when the architect signs off on the spec.

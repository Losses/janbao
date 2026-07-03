# DV18-C00 - Implementation Journal

Implementation of the mobile forward-swipe-past-Messages-enters-Search feature, per the Round-6-approved `docs/DV18-Plan.md` (5/5 PASS, all organic=clean). The architecture: a `forwardDeepNeighbour` data field on `TabDef`, a pure `resolveForwardTarget` resolver, a `forwardEdge` module-singleton store (reveal/inFlight/commit), and a `ForwardEdgeOverlay` component, with `MobileTabPager.svelte` reduced to a general forward-edge dispatch hook.

## Files

**New:**

- `src/lib/utils/forward-edge.ts` - pure `resolveForwardTarget(activeIndex)` returning `ForwardTabTarget | ForwardDeepTarget | null`. Runes-free.
- `src/lib/stores/forward-edge.svelte.ts` - module-singleton store mirroring `active-gesture-track.svelte.ts`: closure `$state` `reveal`/`inFlight`; `setReveal`/`clearReveal`/`reset`/`commit`; getters; `initForwardEdgeStore`/`getForwardEdgeStore`. The only `goto` in the change lives in `commit`.
- `src/lib/components/atoms/ForwardEdgeOverlay.svelte` - the right-edge reveal overlay, generic forward-arrow affordance (not search-branded), z-30, `pointer-events: none`, 40 px right-edge inset. Reads `forwardEdge.reveal`.
- `src/lib/utils/forward-edge.test.ts` - unit tests for `resolveForwardTarget`.

**Modified:**

- `src/lib/utils/tab-config.ts` - `forwardDeepNeighbour?: string` on `TabDef` and `TabDefData`; `'/search'` on the messages `RAW_TAB_DEFS` entry; `forwardDeepNeighbour: tab.forwardDeepNeighbour` in the `MOBILE_TAB_DEFS` map (four sites).
- `src/lib/components/templates/MobileTabPager.svelte` - `resolveForwardTarget` + `target.kind` dispatch in `swipeMove`/`swipeEnd`; `forwardEdge.setReveal`/`clearReveal`/`reveal` reads; the `dragging` predicate term at `:105`; `forwardEdge.reset()` in `onMount`/`onDestroy`; `<ForwardEdgeOverlay />` in the viewport; `forwardEdge.clearReveal()` in the back-edge branch (so a forward-then-reversed drag tears down the reveal).
- `src/routes/+layout.svelte` - `initForwardEdgeStore()` alongside the other store inits.

## Organic-clean gate (verified at implementation)

`git diff -- MobileTabPager.svelte` carries only the general dispatch: `resolveForwardTarget` import + call sites, `target.kind` switch, `forwardEdge` store reads (`setReveal`/`clearReveal`/`reveal`/`commit`), the `dragging` predicate term, `<ForwardEdgeOverlay />`, and `reset()` in the lifecycle hooks. No `goto`, no `/search` literal, no `search`/`peek` string token. The feature bodies (reveal state, inFlight guard, goto, overlay markup) live in the three feature-named files. The only `/search` literal in the change is the data value on the messages `RAW_TAB_DEFS` entry.

## Non-blocking items resolved in code

- **`goto` rejection robustness (R6 NB).** The store's `commit` uses `void goto(href).then(settleInFlight, settleInFlight)`; both the fulfilled and rejected handlers clear `inFlight`, and the rejected handler swallows the rejection, so there is no unhandled rejection and the guard clears whether the navigation resolved or failed.
- **`forwardEdge.inFlight` lifecycle (B1).** `commit` sets `inFlight` and clears it when `goto` settles; `reset()` (in `onMount`/`onDestroy`) clears both `reveal` and `inFlight`. The guard is true only during the in-flight window.
- **`swipeMove` back-edge branch (R6 NB).** The back-edge branch now calls `forwardEdge.clearReveal()`, so a forward drag reversed into a back-edge drag tears down the forward reveal immediately.
- **Generic affordance (R6 NB).** `ForwardEdgeOverlay` shows `mdiArrowRight`, a generic forward arrow, not a search magnifier.
- **`resolveForwardTarget` load-bearing for existing tab swipes (R6 NB).** Covered by `forward-edge.test.ts` (the existing Discussions/Activity forward swipes resolve to `{kind:'tab'}`).

## The `dragging`-flush timing (resolved; empirically confirmed)

The `forwardEdge.clearReveal()` at commit clears the `$state` synchronously, and the `MobileTabPager` `$effect` re-runs in the next microtask publishing `pager.dragging = false` before SvelteKit's async `goto` lands. Deterministically, the `onMount` return-teardown (`MobileTabPager.svelte:146`) also sets `pager.dragging = false` when the pager unmounts at the route swap; that unmount precedes `/search` mounting and Effect E's `$effect.pre` re-run. The runtime verification (below) confirmed Effect E fired at land (the Header rendered the search input and the SearchTabBar), so `pager.dragging` was false at land as reasoned.

## Test results

- **Unit (`bun test src/lib/utils/forward-edge.test.ts`):** 3/3 pass (tab target for non-last tabs; deep target for Messages; null for out-of-range/no-neighbour).
- **Type check (`bun run check`):** 0 errors, 0 warnings across 1434 files.
- **Lint (`bun run lint`):** exit 0. The new files add no similarity duplicates and no eslint errors. (Pre-existing docs em-dashes in the DV18 audit/plan docs were replaced with semicolons/hyphens to satisfy `local/no-emdash`.)

## Deviations from the plan

None functional. The store's `commit` uses `void goto(href).then(settle, settle)` rather than the plan's illustrative `.finally(() => inFlight = false)` shape; both clear `inFlight` on settle, and the `.then` form additionally swallows the rejection (resolving the goto-rejection non-blocker inline rather than via a separate `.catch`).

## Runtime verification (mobile, dev server)

Driven end-to-end in a mobile-emulated (390x844, touch) Chrome against `bun run dev`, with a synthetic touch-pointer forward swipe on the `/messages/inbox` viewport:

- The forward swipe revealed the `ForwardEdgeOverlay` (`forwardEdge.reveal` grew to ~195 px during the drag), then committed: `location.pathname` became `/search`.
- `forwardEdge.reveal` cleared to null and `forwardEdge.inFlight` cleared to false after the commit (the B1 fix; the guard does not strand).
- `/search` rendered in search mode (the search input focused, the SearchTabBar scope row visible), confirming Effect E fired at land, so the `dragging`-flush reasoning holds at runtime.
- `history.back()` from `/search` returned to `/messages/inbox` (the `goto` push left the source behind).
- Zero console errors or warnings across `/`, `/messages/inbox`, the swipe, and `/search`.

This covers the non-blocking items the plan carried: the B1 in-flight lifecycle, the dragging-flush timing, the goto push semantics, and the back-swipe round-trip. The RV18 e2e (CDP touch, trajectory sampling) remains the formal implementation audit; this drive confirms the feature works and the non-blockers are resolved.

## RV18-C00 implementation audit (5/5 PASS, all clean)

Two-round 5-agent implementation audit (`docs/RV18-C00-Audit-01.md`, `RV18-C00-Audit-02.md`):

- Round 1: 5/5 PASS, zero blocking, organic 4 clean / 1 has-special-cases. The one flag was real: two `MobileTabPager.svelte` comments contained the literal `Messages -> /search`, violating the plan's strict organic-clean gate (comments-only, no runtime impact, but the gate and the journal's claim were inaccurate).
- Round 1 fix: removed `/search` from those two comments; added `forwardEdge.clearReveal()` to the `wasDeepPreview` back-commit branch for teardown symmetry.
- Round 2: 5/5 PASS, all organic=clean, zero blocking. Loop exit. The DV18 diff to `MobileTabPager.svelte` is general dispatch only (no `goto` call, no `/search` literal, no `search`/`peek` token); feature bodies isolated in `forward-edge.ts` + `stores/forward-edge.svelte.ts` + `ForwardEdgeOverlay.svelte`. (The lone `goto` token at `MobileTabPager.svelte:167` is a pre-existing comment in the URL-sync effect, not a DV18 addition.)

Carried to future (non-blocking): the `ForwardEdgeOverlay` icon paints outside the bg for very-small reveals; a second forward swipe during the in-flight window could briefly re-show the overlay (cosmetic); `resolveForwardTarget` does not clamp negative `activeIndex` (unreachable); the `inFlight` getter has no external reader.

The implementation is approved at 5/5 PASS, all organic=clean.

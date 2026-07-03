# DV18 - Audit Round 5 (extraction: organic-clean reached; B1 blocker)

5 independent role-less auditors examined the Round-5 extraction revision (the deep-edge bodies moved into `forward-edge.ts` + `stores/forward-edge.svelte.ts` + `ForwardEdgeOverlay.svelte`; `MobileTabPager.svelte` keeps a general `resolveForwardTarget` + `target.kind` dispatch + store reads + `<ForwardEdgeOverlay />`) against local `master` (`84099b5`). Result: **organic 5/5 clean** (the DV09 bar reached) but **4/5 PASS, 1 FAIL** on one correctness blocker.

## Tally

| Auditor | Verdict | Organic | Confidence |
| ------- | ------- | ------- | ---------- |
| 1       | PASS    | clean   | high       |
| 2       | PASS    | clean   | high       |
| 3       | PASS    | clean   | high       |
| 4       | FAIL    | clean   | high       |
| 5       | PASS    | clean   | high       |

## The organic bar is met

All five agreed the extraction achieves the DV09 §4.11 organic-clean gate: `MobileTabPager.svelte`'s diff is general dispatch only (resolve + kind-switch + store reads + `<ForwardEdgeOverlay />`), with no `goto`, no `/search` literal, no `search`/`peek` string token. The `forwardEdge` module-singleton store mirrors `active-gesture-track.svelte.ts` (closure `$state` + module fallback + getter), named for the forward-edge concept. The deep href flows as data (`tab-config.ts` → `resolveForwardTarget` → `forwardEdge.commit`). The overlay's affordance is a generic forward arrow. The only `search` token in the change is the `'/search'` data value on the messages `RAW_TAB_DEFS` entry.

## Blocking issue

**B1 (auditor 4, high); `forwardEdge.inFlight` has no clearing mechanism.** The store's `commit` sets `inFlight` and calls `goto`, but the plan specified no path that clears `inFlight`. Since the store is a module singleton surviving remounts, the first commit leaves `inFlight = true` permanently: the user commits Messages→`/search`, returns to `/messages/inbox`, and the next forward-swipe is a no-op forever. The feature would work once per page load. (Auditor 5 flagged the same gap as non-blocking, reading §6 case 4 as implying the guard is temporary, but did not block.)

## Non-blocking concerns (carried to R6)

- `goto` rejection leaves `inFlight` (same root as B1).
- The `dragging`-flush timing (the `forwardEdge.clearReveal()` → store getter → `MobileTabPager` `$effect` → `pager.dragging = false` chain before land) is the one empirical item (§9).
- `resolveForwardTarget` is now load-bearing for existing tab→tab swipes (a resolver bug regresses them); covered by the unit test.
- The `forwardEdge` store is single-consumer (MobileTabPager writes, ForwardEdgeOverlay reads); DV09 §4.11 endorses this shape, but it lacks `activeGestureTrack`'s ancestor-consumer structural motivation (it is chosen for parity, not necessity).

## Revision decision

Fix B1: `commit` clears `inFlight` in `goto`'s `.finally` (so the guard is true only during the in-flight window), and a `reset()` clears both `reveal` and `inFlight` from `MobileTabPager.onMount`/`onDestroy`. See Round 6.

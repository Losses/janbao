# DV20 Cycle 1 Spec: Route DATA model + tag taxonomy

**Architect:** the document owner. **Executor:** the Cycle 1 Manager Agent (CMA1). **Protocol:** `docs/DV20-Plan.md` §11 (binding). **Status:** ready for CMA1.

## Scope

Replace the imperative route-classification web with one `RouteData` record per route. The record becomes the single source of truth for a route's navigation and gesture attributes. The classifier functions become reads of the record (or are removed, with their call sites reading the record directly). Behavior is identical to the current codebase; this Cycle relocates route knowledge from imperative functions to data, it does not change any gesture, animation, cache, or lifecycle behavior (those are Cycles 2 to 5).

## Background (read these)

- `docs/DV20-Plan.md` §3 (the `RouteData` shape), §4 (tags), §11 (protocol), §13 (values), §14 (signed-off decisions).
- The current classification web in `src/lib/utils/route-config.ts` and `src/lib/utils/history-nav.ts`: `isTabRootPath`, `isPagerRoute`, `isGesturePageLayoutRoute`, `isOverlayRoute`, `isComposeRoute`, `getCurrentTabIndex`, `backSwipeShouldPopHistory`, `getRouteFabRule`, `sourceListKindForOverlayOrCompose`, `isDiscussionsListRoute`, `isMessagesListRoute`, `backTargetListKind`, `fabKindToLabelKey`, plus the `ROUTE_CONFIGS` / `DEEP_ROUTES` / `GLOBAL_PREFIXES` / `MOBILE_TABS` data. Around 130 to 138 call sites consume these across the gesture, navigation, FAB, Header, and scroll modules.

## End state (the WHAT; the HOW is the CMA's to determine)

1. A `RouteData` record exists for every route under `src/routes/` and for every pattern in `ROUTE_CONFIGS`. The record's shape is `docs/DV20-Plan.md` §3. Each field is sourced from the route's actual mount and behavior (the CMA derives each by reading the route's `+page.svelte`, its load function, and its current classification; the research inventory in `docs/DV20-Meeting/DV20-Plan-Journal.md` is a starting point that the CMA verifies against the code).
2. Tags are assigned per §3 and §14.1: `/`, `/activity`, `/messages/inbox` are `tab`; `/discussion/*`, `/messages/[id]`, `/messages/new`, `/messages/add/*`, `/post/discussion`, `/bookmarks`, `/profile/*`, `/admin/*`, `/notifications`, and the other non-search deep routes are `detail`; `/search` is `search`. The CMA verifies each assignment empirically (how the route is reached, how it is left, whether it mounts a GPL, whether it owns a sub-pager).
3. Every classifier function that expresses a target-architecture concept is either removed (call sites read the record directly) or reduced to a one-line read of the record. The single exception is `isGesturePageLayoutRoute`, which encodes a migration-era concept (GPL ownership) that has no field in the target record; it stays imperative and untouched until Cycle 5. No OTHER imperative classification body remains. The record is the single source of truth for the concepts it holds.
4. The record holds NO migration-era or tag-duplicating fields. Specifically there is no `isSpatial`, no `headerMode`, no `gestureOwner` field (per §3's clarity principle: `isSpatial` and `headerMode` are derived from the tag; `gestureOwner` is a component-architecture property that dissolves in Cycle 5). The CMA must not re-introduce any of them as stored fields. The latent `isGesturePageLayoutRoute('/search') === false` bug is pre-existing and masked; it is NOT fixed in this Cycle (no clean data field expresses it) and is deferred to Cycle 5.
5. The organic-integration gate holds: the gesture primitives (`GesturePageLayout.svelte`, `MobileTabPager.svelte`, `swipe.ts`) gain no feature-named literals from this refactor. The records are named for the route/gesture concepts, not for any single feature.
6. The clarity principle (§3) is upheld end-to-end: the `tag` is the only primary categorization; every other stored field is genuinely independent of it (a route may carry any combination). If the CMA finds itself wanting a field that just renames or negates the tag, it is a derived helper, not a stored field.

## Constraints

- **Behavior-preserving.** The existing e2e suite (the gesture, tab, search, FAB, header specs) passes unchanged. This is the regression bar. The CMA decides how to demonstrate this (§11 anti-cheating: the architect does not prescribe the commands).
- **Pure data relocation.** Do NOT touch gesture detection, animation timing, cache reads, or lifecycle hooks. Those are later Cycles. If a call site's behavior would change, that is a deviation to flag, not a change to make.
- **No shortcuts.** Do not leave a classifier with its old imperative body "for now". Do not add a parallel classification path. The record is the single source of truth or the Cycle is not done.
- **No git mutation.** Work in the working tree. No stash/checkout/reset/clean/switch/commit/push.
- **Audit protocol (§11).** Five independent auditors per round, role-less and hint-less, to 5/5 unconditional PASS with zero concerns. PASS-with-concerns is not PASS.

## Out of scope (do not touch)

- The state machine, the tag-pair resolvers, the executor, the unified `PageCacheStore`, the `PageLifecycle` contract. These are Cycles 2 to 5.
- The forward-swipe Messages to `/search` behavior. It is unchanged in this Cycle.
- Any animation, timing, or gesture-feel change.

## Deliverables

- The `RouteData` records, in whatever home the CMA determines is cleanest (`src/lib/utils/route-config.ts`, a new `src/lib/utils/route-data.ts`, or another location the CMA justifies).
- The migrated classifier functions and/or their call sites.
- Unit tests for the records and for the derived queries the consumers need (the CMA decides the test surface; `tab-config.ts` and `navigation-logic.ts` are already unit-tested under `bun:test`, follow that pattern).
- The existing e2e suite passing unchanged (the CMA determines which specs are in-scope and pastes the evidence).
- `docs/DV20-Cycle-1-Journal.md`: the implementation journal, recording what actually happened (files changed, decisions, deviations, failures, the real verification evidence pasted).
- `docs/DV20-Meeting/DV20-Cycle-1-Audit-R{M}.md` per audit round (the role-less, hint-less audit results, 5/5 zero-concern at exit).
- `docs/DV20-Meeting/DV20-Cycle-1-Plan-Journal.md`: append-only revision history of the CMA's spec interpretations across audit rounds.
- A final report (the CMA's last message to the architect): files changed, audit tally per round against the zero-concern bar, verification evidence pasted, deviations, carried-to-future items.

## What the architect will check at review

- Is the record the single source of truth for the concepts it holds (no imperative classification body survives, except the deferred `isGesturePageLayoutRoute`)?
- Does the record hold only target-clean fields (no stored `isSpatial`, `headerMode`, or `gestureOwner`; they are derived or deferred per §3)?
- Is behavior identical (the e2e evidence)?
- Did the audit reach 5/5 zero-concern with role-less, hint-less prompts (the architect will read the audit files)?
- Is the journal honest (failures recorded, evidence pasted, no performed confidence)?
- Are the values (§13) upheld?

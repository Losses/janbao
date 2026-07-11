# RV20-C05b2 - Audit Round 1 (architect-run, 2 independent auditors)

Result: **A FAIL; B FAIL.** Both found the same three HIGH findings + independent
MED/LOW findings. Counter stays 0/5.

Both auditors were run with a clean, role-less, non-leading prompt that
**explicitly forbade reading the Journal and all audit report files**.

## HIGH findings (both auditors, consensus + A-only)

- **H1 (consensus) - discussion thread `/discussion/[discussionId]/[slug]/[[page]]`
  was NOT migrated:** it still mounted `GesturePageLayout`. The 5b1 pilot was
  `/messages/[id]` (private messages), NOT `/discussion/*` (public discussion
  thread) -- a separate route that was missed. The gate `isNavPipelineRoute`
  excluded `/discussion/`. FIX: migrated to `NavPipelineHost centerTab={0}
leftHref="/"`, added the route to `isNavPipelineRoute`, added gate tests.
- **H2 (consensus) - `.fab-transition` CSS class still present on the FAB atom:**
  a consequence of H1 (the discussion thread on GPL still set `pendingNav`,
  keeping the CSS path live). FIX: removed `.fab-transition` CSS class,
  `transitionEnabled` prop, and `transitionEnabled` derived entirely. No route
  sets `pendingNav` anymore (all routes are pipeline routes now).
- **H3 (A-only) - non-adjacent tab-click geometry broken:** from `/` (tab 0) to
  `/messages/inbox` (tab 2), the orchestrator hardcoded `distance=W` (one panel),
  so the slide revealed the wrong tab and then teleported. FIX: `distance =
|toTabIndex - fromTabIndex| * viewportWidth` when both indices are valid and
  differ by more than 1.
- **H4 (B-only) - gate excluded `/discussion/*`:** a consequence of H1. FIX:
  added to `isNavPipelineRoute` alongside the route migration.

## MED findings

- **M1 (B-only) - NavPipelineTabHost dropped `backSwipeShouldPopHistory`:** the
  old MobileTabPager had a back-swipe-to-deep-page-in-history gesture. The new
  host had no equivalent. FIX: added `#backwardTabTarget` that checks
  `backSwipeShouldPopHistory` and dispatches `history.back()` to the deep page.
  TODO(5b3): overlay the cached deep-page snapshot during the slide (currently
  the previous tab panel serves as a visual proxy).
- **M2 (A-only) - `isGestureRoute` not renamed (End state #6):** still called
  `isGestureRoute` even though every route now mounts `NavPipelineHost`. FIX:
  renamed to `isPipelineSwipeDisabledRoute`. Updated all consumers.
- **M3 (B-only) - `onSvelteKitAfterNavigate` cleared in-flight state on
  param-nav:** the guard only checked `#isEnterAnimation`. FIX: added a guard
  for `#pendingGesture !== null || #pendingTabExit !== null`, discriminated by
  `!#navDispatchInFlight` (so the orchestrator's own dispatch still lands).
- **M4-M5 (both) - stale comments:** FAB atom/layer docstrings still referenced
  the CSS transition, GPL, MobileTabPager, LoadingChip. FIX: rewrote all stale
  docstrings/comments to describe the current all-pipeline architecture.
- **M6 (A-only) - e2e referenced non-existent `isGesturePageLayoutRoute`:** FIX:
  updated comment.

## LOW findings

- Orchestrator + NavPipelineHost docstrings still said "pilot route ONLY" instead
  of "universal pipeline". FIX: rewrote.
- `(tabs)/+layout.svelte` referenced MobileTabPager in present tense. FIX: updated.
- `chipExitActive` was dead on pipeline routes (LoadingChip removed everywhere).
  FIX: removed the dead `chipExitActive` derivation + its uses.
- NavPipelineTabHost scroll-chrome cleanup used `setScrollContainer(null)` instead of
  `releaseContainer`. Documented (functionally equivalent).

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1462 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    429 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab    92 passed
```

Consecutive pass votes: **0** (both FAIL; all HIGH + MED fixed; R2 audits the
post-fix state).

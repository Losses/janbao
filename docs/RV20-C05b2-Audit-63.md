# RV20-C05b2 - Audit Round 63

Result: **A PASS-WITH-CONCERNS (1 CONCERN); B PASS-WITH-CONCERNS (1 CONCERN).**
Counter stays **0/5**. R63 audited the post-R62 tree. Both auditors verified
the core pipeline clean (one mechanism, no animation-layer CSS transitions or
`setTimeout`, state machine authority, every sampled trajectory clears, the
R60/R62 fixes hold). Two narrow findings, both fixed.

## B's finding

1. **`#queuedDiscreteNav` survived a gesture interrupt in `#beginGesture`
   (LOGIC, FIXED).** `#beginGesture` cleared `#pendingDiscreteNav` (the
   in-flight tab-click) but not `#queuedDiscreteNav` (a tab-click queued by
   the finish-then-new policy). Trajectory: a commit is in flight, the user
   taps a tab (finish-then-new queues the tab-click and accelerates the
   commit), then the user starts a new gesture before the accelerated commit
   settles; `#beginGesture`'s `executor.onDragStart` stops the accelerated
   commit rAF so `#onExecutorSettle` / `#landAtRest` never consume the queue,
   and the new gesture's landing fires the stale queued tab-click, overriding
   the user's latest direct action. Fixed: `#beginGesture` clears
   `#queuedDiscreteNav` alongside `#pendingDiscreteNav` (a gesture is the
   user's latest direct action and supersedes a queued discrete nav). Same
   leak class as the R26 / R37 `#queuedDiscreteNav` orphan variants. (A's
   clear-site sweep missed this one; it listed `#beginGesture` as a
   clear-site for `#queuedDiscreteNav`, but `#beginGesture` only cleared
   `#pendingDiscreteNav`.)

## A's finding

1. **`isNavPipelineRoute(target)` mis-classified a pipeline route carrying a
   search suffix (LOGIC, FIXED).** `#onExecutorSettle` and `#dispatchNav`
   call `isNavPipelineRoute(target)` where `target` is the full
   `#pendingDiscreteNav.target` (pathname + search, e.g. `/messages/inbox?page=2`,
   `/?q=foo`). The gate pattern-matched the bare pathname, so a search suffix
   flipped a pipeline route to non-pipeline: the non-pipeline branch ended the
   settle early (Header morph snap) and `#lastLandWasPipelineCommit` was set
   false, so a following isSearch flip armed a tap-scrub that should have been
   suppressed (a 200 ms search-panel slide-in-and-out on a pipeline landing).
   Fixed: `isNavPipelineRoute` strips a `?search` suffix before classifying
   (the function already stripped `/pN`; the search strip is consistent, and
   every caller benefits). A regression test covers the search-suffix cases.

## Things both auditors verified clean

One transition mechanism; no CSS transitions or animation-layer `setTimeout`
(the Header search-debounce and the `swipe.ts` click-swallow timer are the
spec-excluded input/cleanup paths; the drawer snap is the spec-excluded
`captureSwipe` gesture); the state machine is the authority; every sampled
trajectory (gesture commit/cancel, tab-click mid-transition, deep-to-deep,
back-swipe, forward enter, pointercancel, non-pipeline detour, host destroyed
mid-drag, mid-settle title revert, gesture commit to a non-pipeline
back-target) clears correctly; no U+2014 em dashes; all spec-removed
identifiers gone.

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

R64 audits this state.

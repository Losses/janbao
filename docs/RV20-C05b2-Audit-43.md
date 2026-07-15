# RV20-C05b2 - Audit Round 43

Result: **A PASS-WITH-CONCERNS (3 CONCERN); B PASS-WITH-CONCERNS (1 CONCERN).**
Counter stays **0/5**. R43 was the cleanest round so far: both auditors
verified the core architecture and all six Known conditions are correct, and
the four findings are all minor (one masked data inconsistency, one dead-data
field, two comments). All four fixed.

## A's findings (3 CONCERN)

1. `route-data.ts:252-257` (data) - `/profile/settings` had `backParent: '/'`,
   contradicting the spec §3 example (`/profile/settings -> /profile`), the
   field docstring ("structural parent"), and every adjacent profile route.
   Inert in 5b2 (`isPipelineSwipeDisabledRoute` reads only `backParent !==
undefined`) but wrong for 5b3. Fixed: `backParent: '/profile'`; the
   `route-data.test.ts` assertion that codified the old value was updated.
2. `NavPipelineTabHost.svelte:71-79` (comment) - the deep-snapshot overlay
   comment said the slide reveals the panel at `activeIndex - 1` without
   qualifying the `activeIndex === 0` case (suppress-slide, overlay offscreen).
   Fixed: added the `activeIndex === 0` qualification (consistent with the
   orchestrator's `suppressSlide` comment and Known #5).
3. `route-config.ts` + `FloatingActionButtonLayer.svelte` (dead data) -
   `FabKindConfig.tabIndex` was defined, populated, and propagated into
   `FabConfig.tabIndex` in three places, but never passed to the
   `<FloatingActionButton>` atom (its props have no `tabIndex`). The atom is an
   `<a href>` (naturally focusable) and there is one FAB per route, so the
   explicit tabIndex had no consumer. Fixed: removed `tabIndex` from
   `FabKindConfig`, both config entries, the `FabConfig` interface, the three
   propagation sites, and the inaccurate docstrings.

## B's findings (1 CONCERN)

1. `orchestrator` class-level docstring (two instances, ~lines 23-24 and
   49-50) - claimed the app exit triggers the full `unmount()` teardown. Wrong:
   `unmount()` is called only from the mobile->desktop matchMedia flip handlers
   (no `beforeunload`/`pagehide`/`unload` hook exists), and the `unmount()`
   method's own docstring correctly states app exit abandons the singleton.
   Fixed: both instances corrected.

## What both auditors verified clean

No CSS transitions or animation-layer `setTimeout` (§13.3); the orchestrator is
the sole transition mechanism (§13.4); the NavStateMachine is the authority and
`#publication` is a `$derived` (§13.5); one rAF per motion channel (§5); the
FAB layer reads the orchestrator publication directly; `solveCommitDuration`'s
axis-sign is correct; the finish-then-new policy covers commit/cancel/enter;
all six Known conditions are accurately documented and behave as described.

## Gate outputs (post-fix, independently re-run 2026-07-15)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    201 passed + 2 flaky (exit 0)
```

The flaky tests are the known CDP-touch class. The implementation was delegated
to a fresh-context sub-agent and independently re-verified (gate re-run by the
orchestrator, the four diffs checked).

R44 audits the post-R43-fix state.

# RV20-C05b2 - Audit Round 42

Result: **A PASS-WITH-CONCERNS (4 CONCERN); B PASS-WITH-CONCERNS (5 CONCERN, all
comments).** Counter stays **0/5**. B confirmed the core animation logic is
clean (no logic bug in the gesture/commit/cancel pipeline, the FAB scale math,
the settle/tap-scrub rAF lifecycles, the deep-to-deep handshake, or the
finish-then-new policy). Eight findings were fixed; one (A3) was disproven.

## A's findings (4 CONCERN)

1. `orchestrator` `#lastDispatchWasDeepToDeep` (logic, latent) - declared as a
   plain field but read inside the `#publication` `$derived`, so its writes did
   not re-trigger the derived (freshness was incidental). CONCERN. Fixed: made
   `$state`. Load-bearing now that `NavPipelineHost.forwardDeepTarget` reads
   `publication.lastDispatchWasDeepToDeep` reactively.
2. `orchestrator` `#enterAnimationArmedSettle` (logic) - the flag was consumed
   at the top of `notifyHeaderState` before the idle-arm could read it, so for
   normal motion it was dead and a live-title change arriving after the enter
   settle could re-arm from progress 0 and snap the morph. CONCERN. Fixed: the
   flag now persists through the settle and is spent by the idle re-arm,
   `#armSettleEase`, the mid-settle title-match branch, and `releaseInputs`.
3. FAB dips to 0 during a boundary void-swipe (claimed logic) - **disproven
   (false positive)**. `e2e/fab-boundary-swipe-sync.spec.ts` asserts the FAB
   MUST vary (delta > 0.1) during a boundary void-swipe, and its docstring plus
   the `fab-boundary-swipe-clamp` memory state the intended design: the FAB
   reads the unclamped raw progress and dips along it. Holding the FAB steady
   failed both boundary tests; the fix was reverted.
4. Backward gesture to a higher-indexed tab inverts the touch direction
   (geometry) - documented as Known condition #6 (the 3-panel layout forces a
   leftward translate to reveal a higher-index tab while the finger moves
   right; macro §6 mandates the temporal-previous target). No track-layout
   change.

## B's findings (5 CONCERN, all stale comments - the coverProgress class)

1. `NavPipelineHost.svelte:529-531` - claimed the FAB at-rest scale reads
   `pager.coverProgress` and cited a non-existent test. Fixed: the at-rest
   source is `getRouteData(pathname).fab ? 1 : 0`.
2. `Header.svelte:90-97` - claimed the settle/tap-scrub fields are `$state` on
   the orchestrator; they are on `NavStateMachine` (orchestrator exposes them
   via `$derived` pass-through). Fixed.
3. `nav-resolvers.ts` (5 instances) - "FAB/Header read the pager store"; true
   for the Header, false for the FAB (it reads the orchestrator publication
   directly). Fixed in all 5.
4. `route-config.ts:144,151-152` - referenced `coverProgress` as the FAB scale
   driver. Fixed to `fabScale(publication.progress, fromHasFab, toHasFab)`.
5. `nav-executor-logic.ts:405` + `nav-executor-logic.test.ts:626` - "the raw
   `coverProgress` the FAB/Header read"; the FAB reads `publication.progress`.
   Fixed.

## Fixes

- A1: `#lastDispatchWasDeepToDeep = $state(false)`.
- A2: `#enterAnimationArmedSettle` restructured to actually suppress a
  post-enter idle re-arm; docstring + `playEnterAnimation` comment updated.
- A3: reverted (false positive; intended FAB-dip behavior).
- A4: Known condition #6 added to the spec.
- B1-B5: the coverProgress comment class rewritten to the current
  `fabScale(publication.progress, ...)` mechanism across NavPipelineHost,
  Header, nav-resolvers (5), route-config, nav-executor-logic + test.

The implementation was delegated to a fresh-context sub-agent (long
orchestrator-side context) and independently re-verified: the gate was re-run
by the orchestrator, the A3 revert confirmed (the FAB layer has no diff), and
the `$state` + Known-condition changes were checked directly.

## Gate outputs (post-fix, independently re-run 2026-07-15)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The one flaky test is `fab.spec.ts:435` (the known CDP-touch class).

R43 audits the post-R42-fix state.

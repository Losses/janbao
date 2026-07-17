# RV20-C05b2 - Audit Round 68

Result: **A PASS-WITH-CONCERNS (1 CONCERN, comment accuracy); B PASS-WITH-CONCERNS
(1 CONCERN logic + 1 CONCERN comment).** Counter stays **0/5**. R68 found one
real (narrow) visual defect (B1) plus comment accuracies. All fixed.

## A's finding

1. **`RouteStack` docstring inaccurate + propagating references (COMMENT, FIXED).**
   The `RouteStack` docstring claimed "the orchestrator builds the live stack
   from the navigation history"; the orchestrator passes an empty `{ entries: [] }`.
   The `direction` field is precomputed from the gesture classification, not the
   stack. The same inaccuracy propagated to `TransitionDirection` and
   `ResolverInput`. Additionally, `ResolverInput`'s docstring still referenced
   "the live offset streams to the executor" (a residual from R65 B2's
   `liveOffset` removal that both A and the R65 sub-agent missed). All four
   docstrings rewritten. (Orchestrator-initiated sweep also found + fixed two
   more residuals: `nav-resolvers.ts:36` "live offset streams separately" and
   `nav-resolvers.ts:125` "precomputes from the stack", plus `nav-intent.ts:7`
   "live offset" reworded to "drag offset".)

## B's findings

1. **`#enterAnimationArmedSettle` not cleared when the settle ends naturally
   (LOGIC, FIXED).** For dynamic-title routes (`resolveDeepHeaderTitle` returns
   null), `playEnterAnimation` arms the settle with `incomingTitle = ''`. If
   `page.data.headerTitle` resolves AFTER the settle rAF reaches u=1 (data load
   slower than the velocity-matched `commitDurationMs`, ~300ms), the settle ends
   via `#endSettleEase` WITHOUT clearing the flag. The first subsequent title
   change then hits the idle branch where the flag suppresses the arm, and the
   Header title snaps from `''` to the live title with no crossfade. Fixed:
   `#endSettleEase` clears `#enterAnimationArmedSettle` (the settle ended = the
   enter is done; a later idle title change should crossfade, not snap). The
   normal case (live title arrives mid-settle, site c clears the flag) is
   unaffected.
2. **Stale comment in `e2e/backtarget.spec.ts` (COMMENT, FIXED).** The test
   docstring described the `activeIndex=0` backward-to-deep-page trajectory as
   having an "intentionally imperfect" visual proxy with "Known #9" still open
   and "the 5b3 deep-snapshot overlay is the planned fix." The current code
   `suppressSlide` sets `distance = 0` for this case (no slide runs). Reworded
   to describe the current behavior.

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 2 flaky (exit 0)
```

R69 audits this state.

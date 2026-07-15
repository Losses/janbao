# RV20-C05b2 - Audit Round 37

Result: **A PASS-WITH-CONCERNS (4 CONCERN + 3 nitpicks); B PASS-WITH-CONCERNS
(1 CONCERN + 1 nitpick).** Counter stays **0/5**. This is the first audit of
the unified FAB scale mechanism. Five concerns: four stale comments referencing
the deleted family-swap mechanism (A), and one logic defect in the
#queuedDiscreteNav orphan path (B). All fixed.

## A's findings (4 CONCERN, stale comments from the FAB refactor)

1. `orchestrator:1655` - `#cancelAllAnimationEases` comment lists "family-swap
   ease" (deleted; only settle + tap-scrub remain). Fixed: removed the reference.
2. `route-config.ts:17-24` - file header claims `family` "selects the FAB layer's
   scale driver" and is "permanent." Inaccurate: the FAB scale is now
   `fabScale(progress, RouteData.fab)`; family is only read by
   `isPipelineSwipeDisabledRoute` and marked for dissolution in §3. Fixed.
3. `route-config.ts:96` - same inaccuracy (inline). Fixed.
4. `fab-scale.ts:51-55` - `FabFamily` docstring claims it "mirrors the layer's
   FabConfig `family` discriminant." FabConfig has no `family` field. Fixed.

## B's finding (1 CONCERN, logic defect, fixed)

### #queuedDiscreteNav orphan when the orchestrator's goto is cancelled

When the finish-then-new policy queues a discrete nav, and the commit's goto is
CANCELLED by a competing external navigation (session-timeout, user URL, app-level
goto) before it lands, `#landAtRest` never runs, so `#queuedDiscreteNav` persists
on the singleton. The next pipeline route's `#landAtRest` fires a phantom redirect.

Fixed: clear `#queuedDiscreteNav` in `onSvelteKitBeforeNavigate` after the
dispatch-reentry checks (any external nav invalidates the prior queue). The
legitimate finish-then-new's goto returns at the earlier dispatch-reentry check
(target matches `#dispatchTarget`), so it is unaffected.

## Spec nitpicks (`.md`, fixed)

The spec's "Global animation manager" section, end-state #2, §5 invariant, and
Step 2 all described the old `familySwapScale` / `#lastRenderedScale` /
`#startFamilySwapEase` mechanism. Updated to describe the unified
`fabScale(progress, fromHasFab, toHasFab)` mechanism.

## Gate outputs (post-fix, independently re-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (fab.spec.ts:432)
```

R38 audits the post-R37-fix code.

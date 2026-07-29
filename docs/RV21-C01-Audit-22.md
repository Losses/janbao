# RV21-C01 Audit 22 (R22)

**Date:** 2026-07-29. **Round:** R22. **Counter after:** 0/5 (auditor A BLOCK;
auditor B PASS).

## R22-A F1 (§5, primary, probe-verified 3/3): morph snaps at the drag-to-discrete-nav handoff when the drag's target's tab-ness differs from the discrete-nav's destination's tab-ness

The discrete-nav arm's `liveDragMorph` capture
(`orchestrator:2558-2568`) computes `liveDragMorphIncomingHasTabs` and
`liveDragMorphTargetIsSearch` from `toPathname` (the DISCRETE-NAV's destination),
not from the drag's target (`pending.to`). When the drag's target has different
tab-ness than the discrete-nav destination, the helper misclassifies the drag's
shape, the settle-arm condition evaluates false, no settle is armed, and the
morph snaps from the drag's terminal value to the at-rest value (~54-57deg /
~12-13px, probe-verified on 3 shapes).

**Fix (R22-A specifies):** capture `dragTargetPathname = this.#pendingGesture?.to`
before the reset; compute `getCurrentTabIndex(dragTargetPathname)` and
`resolveHeaderMode(dragTargetPathname)` instead of from `toPathname`. Collapses
to `outgoingHasTabs` for both branches when no drag was in flight (from-rest).

## R22-B: PASS

Independently confirmed closure from a different angle (anchor capture/clear
timing, helper math, docstring precision). No defect found.

## Counter after R22: 0/5.

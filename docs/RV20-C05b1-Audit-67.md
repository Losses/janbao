# RV20-C05b1 - Audit Round 67 (architect-run, 2 independent auditors)

Result: **A PASS (3 non-blocking observations); B PASS-WITH-CONCERNS (2 LOW).**
Zero MED/HIGH. Counter stays 0/5.

This is the FIRST audit of the post-refactor state (Session 18 dissolved
`chipExit` and unified the pilot's FAB on `f(progress, target)`). Both auditors
were run with a clean, role-less, non-leading prompt that described the unified
model and **explicitly forbade reading the Journal and all
`RV20-C05b1-Audit-*.md` files**. Neither saw prior-round results.

Both verified the unified following-visual model: every visual is a pure function
of `coverProgress` + the transition target, with no per-transition forced value.
The FAB scales in for a FAB-bearing target (`/messages/inbox`, `/`) and stays
hidden for a target without one (`/activity`, the forward-enter to the
conversation). A additionally verified the interrupt handoff across
enter/gesture/tab-click/re-grab, the commit-settle dispatch, and stated there are
no inaccurate comments in the new wiring files.

## Concern + fix

- **B C1 (LOW, comment accuracy) - FIXED:** the FAB layer's Family B docstring
  and the `foregroundFraction` overlay-branch comment said `coverProgress` is
  "published by GesturePageLayout"; that is now false for the pilot route
  (`/messages/[id]` is Family B but `NavPipelineOrchestrator` publishes
  `coverProgress` as the raw slide fraction). FIX: both comments now name both
  publishers (GesturePageLayout for non-pilot overlay/compose routes;
  `NavPipelineOrchestrator` for the pilot). Still accurate for the non-pilot
  overlay routes (`/discussion/*`).

## Documented (non-defect / edge case)

- **B C2 (LOW, edge case) - a mid-commit re-grab with a leftward-past-start
  component freezes `coverProgress` at `rawStart`:** `#rawDragFraction` clamps
  the offset with `Math.max(0, ...)` for a rightward-classified drag, so a finger
  moving leftward past the re-grab start cannot drag the revealed panel back down
  mid-gesture. Reachable only on a mid-commit re-grab with a leftward component
  (the re-grab e2e uses two rightward swipes). NOT a clear regression: GPL's
  re-grab re-bases `rawDragOffset` from the new start and produces a jump to ~0
  instead; both implementations are imperfect at this edge in different ways. The
  rightward re-grab handoff (the common, intended case) is correct. Recommend the
  architect confirm whether bidirectional mid-commit re-grab tracking is in 5b1
  scope.

## Non-blocking observations (A)

- **A C1:** `#publish` spreads `#publication` into a new object each frame during
  a gesture, so the host's `sawTransition` `$effect` re-runs ~60/sec during a
  drag. The effect body returns early when `plan !== null`, so it is correct but
  wasteful. Not a correctness or spec issue.
- **A C2:** at the pilot's commit-settle + dispatch, the pager store retains
  `fractionalIndex: centerTab` / `coverProgress: 1` until the destination route
  publishes its own state. Svelte 5 processes the destination's mount effects in
  the same flush as the pilot's `onDestroy` (before paint), so the stale values
  are overwritten before the browser paints; no visible flash in practice. A
  delayed first-publish would produce a one-frame wrong FAB scale.
- **A C3:** the resolver's `buildFabPlan` output is computed each frame but
  discarded (the host passes `fab: null, header: null`; the driver skips those
  write branches). The real FAB behaviour comes from the FAB layer reading
  `pager.coverProgress` + `pilotTransitionListKind`. Both use the same `2f-1`
  formula, so they agree; the resolver path is dead computation for the pilot.
  Documented in the code comments.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab    92 passed
```

Consecutive pass votes: **0** (B carried a LOW; the comment accuracy fixed, the
re-grab edge documented; R68 audits the post-fix state).

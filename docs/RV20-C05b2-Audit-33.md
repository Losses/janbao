# RV20-C05b2 - Audit Round 33

Result: **A PASS-WITH-CONCERNS (4 CONCERN); B PASS-WITH-CONCERNS (5 CONCERN).**
Counter stays **0/5**. Nine concerns: four stale "5b1" labels (A), three stale
comments + two functional defects (B). All addressed this round.

## A's findings (stale "5b1" / "pilot" labels)

A flagged four; the orchestrator's repo-wide grep found fifteen total. All
labeled the now-global-singleton orchestrator / pointer-bridge / hosts as
"5b1"-specific or "pilot"-specific (the prior cycle's scope, dissolved by the
5b2 generalization). All rewritten to the current architecture; `grep -rn "5b1"
src/` now returns zero.

## B's findings

### B1, B2 (CONCERN, comment accuracy)

- `gesture-constants.ts` `TRACK_TRANSITION_MS` docstring said the family-swap
  ease runs in the FAB layer; it runs on the orchestrator's rAF (the layer reads
  `pager.familySwapScale` reactively). Rewritten.
- `GESTURE_MORPH_EPSILON` (exported, zero consumers) referenced a non-existent
  "Effect B". Deleted (dead code).

### B3 (CONCERN, comment accuracy)

- `mobile-pager.svelte.ts` docstring said the settle/search-scrub state is "owned
  by the orchestrator as private class `$state`"; it lives on `NavStateMachine`
  (the orchestrator's getters are `$derived` pass-throughs). Rewritten.

### B4 / F4 (CONCERN, functional, fixed)

- `playEnterAnimation` could no-op when the singleton executor's state was stale
  at `configure` time. A prior commit that settled (activePlan set, progress=1)
  but whose navigation was cancelled before landing left the executor holding
  progress=1; `configure` reset only the orchestrator's `#progress`, not the
  executor's state, so the next host's `playEnterAnimation` read progress=1 via
  `#startProgressFromCurrentVisual` and `startCommit`'s `state.progress ===
target` guard returned idle (no slide). Fixed: `configure` now calls
  `executor.onLand()` (verified to only stop the rAF, clear activePlan, and reset
  the state record - no side effects; the family-swap/settle/tap-scrub eases live
  on the orchestrator and are unaffected).

### B5 / F5 (CONCERN, functional, documented limitation)

- `#fabDragSeedFraction` does not cover a Family-A-to-tab gesture (tab-to-tab,
  both list family) interrupting a family-swap ease: the FAB layer's
  `foregroundFraction` reads `trackFractionalIndex` for tab-to-tab, which the
  coverProgress-based seed does not feed, so the FAB scale jumps from the mid-ease
  value to the track-derived value. A correct continuity bridge is infeasible:
  seeding `trackFractionalIndex` would corrupt `effectiveKind` (the kind-swap
  midpoint) and the `displayConfig` gate, and the seed would bridge only one frame
  (the first `onDragMove` overwrites it) - the discontinuity is fundamental to the
  1:1 finger-tracking invariant. Documented with a detailed comment at the
  tab-to-tab branch; the 1:1 tracking invariant takes precedence. (If a future
  round judges this an unacceptable defect rather than a justified limitation, it
  would need a spec Known-condition entry or a deeper redesign.)

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    409 pass / 0 fail
$ bun run test:e2e                    200 passed + 2 flaky (fab.spec.ts:432
                                     pre-existing; fab-release-snap.spec.ts:192
                                     timing jitter under full-suite load, passes
                                     3/3 in isolation; both pass on retry)
```

The F4 configure-onLand change is e2e-safe (enter-animation + fab specs pass;
the fab-release-snap flake is timing jitter, not F4-caused - F4's configure is
not reached on a tab-to-tab gesture). No behavioral regression.

R34 audits the post-R33-fix state.

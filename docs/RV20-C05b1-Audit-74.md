# RV20-C05b1 - Audit Round 74 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (1 LOW); B PASS-WITH-CONCERNS (1 MED + 1 LOW).**
Counter stays 0/5.

Both auditors verified UNIFY, the unified following-visual model, the release
gate (final-release offset), the cross-type interrupt handoff, the coverProgress
continuity, the FAB kind resolution, the bidirectional re-grab, and the comment
accuracy. Both were run with a clean, role-less, non-leading prompt that
**explicitly forbade reading the Journal and all `RV20-C05b1-Audit-*.md` files**.

## Fixes

- **B C1 (MED) - the forward-enter snapped the FAB from ~0.85 to 0 instead of
  easing over 200ms:** a side-effect of the R73 fix. The `pager.transitionTarget
=== null` gate in `transitionEnabled` killed the CSS transition as soon as
  `playEnterAnimation` set `transitionTarget` (one rAF after mount), snapping the
  FAB mid-family-swap-ease. Root cause: the gate was too broad. The correct
  distinction is not "is there a transition target" but "is the rAF driving the
  FAB." FIX: the gate is now `pilotTransitionListKind === null`. When the target
  has a resting FAB (`pilotTransitionListKind !== null`: back-swipe to inbox,
  tab-click to discussions), the rAF drives the FAB and the CSS transition is OFF
  (no double-easing). When the target has no resting FAB
  (`pilotTransitionListKind === null`: forward-enter to conversation, tab-click to
  /activity), the FAB is forced to 0 by the foregroundFraction short-circuit and
  the CSS transition eases the family-swap scale-out (e.g. the inbox FAB scaling
  1 to 0 on the forward-enter). This correctly handles both the R73 MED (stale
  `discreteNavInFlight` double-easing during rAF-driven commits) and this MED
  (CSS transition killed during the forward-enter family-swap ease).
- **A C1 (LOW) - the forward-enter seed vs tab-click race:** `playEnterAnimation`
  was deferred via `requestAnimationFrame`, creating a ~1-frame window where a
  tab-click's `beforeNavigate` could arrive before `executor.activePlan` was set,
  causing a one-panel visual jump (the tab-click path computed `startProgress = 0`
  from the null plan, writing `translateX(-Wpx)` while the track was seeded at
  `translateX(0px)`). FIX: `playEnterAnimation` now runs synchronously in
  `onMount` (the DOM is mounted so `clientWidth` is available), so
  `executor.activePlan` is non-null before any `beforeNavigate` can arrive.

## Documented (non-defect)

- **B C2 (LOW) - skeleton `{:else}` branches unreachable:** documented defensive
  fallback (eager-load always truthy); the spec-mandated skeleton atom exists and
  composes correctly.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    424 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab    92 passed
```

Consecutive pass votes: **0** (both PWC; the MED + the seed-race fixed; R75
audits the post-fix state).

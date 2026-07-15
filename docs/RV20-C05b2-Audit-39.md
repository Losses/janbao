# RV20-C05b2 - Audit Round 39

Result: **A PASS-WITH-CONCERNS (3 CONCERN, 2 logic bugs); B PASS-WITH-CONCERNS
(3 CONCERN, 1 a logic gap).** Counter stays **0/5**. R39 found three real
logic defects the prior rounds missed, plus three comment / docstring / test
accuracies. All fixed; the logic fixes carry preventive tests.

## A's findings (3 CONCERN)

1. `NavPipelineHost.svelte:185-191` - `forwardDeepTarget` classified a
   backward deep-to-deep back-swipe as a forward deep-to-deep (it checked
   `transitionTarget` and tab-root, but not `publication.direction`), so the
   left panel rendered `<DeepPreviewSkeleton />` instead of the back-target's
   cached preview panel. CONCERN (logic bug).
2. `nav-executor-logic.ts:211-243` - `progressVelocity = clampedVelPx /
distancePx` did not normalize for `plan.pageTrack.axis`. For `axis='left'`
   (forward tab swipes on the bidirectional tab host) a leftward release is
   progress-positive but computed negative, so the `directionSign *
progressVelocity <= 0` gate fired and every forward commit fell back to
   `COMMIT_T_DEFAULT_MS` instead of the velocity-matched solve. CONCERN (logic
   bug).
3. `nav-executor-logic.test.ts:258-303` - the velocity tests pinned the axis
   bug as intended (positive velocity for an `axis='left'` commit) and the
   comments mis-described the direction. CONCERN (test pins the bug).

## B's findings (3 CONCERN)

1. `orchestrator:1608-1618` - the orphan-prevention comment claimed the
   replay goto re-enters with `#navDispatchInFlight === true` and returns
   above; `#landAtRest` clears the flag before the replay fires, so it
   re-enters false and is processed fresh. CONCERN (comment).
2. `orchestrator:1602-1624` - the `#queuedDiscreteNav` orphan clear at 1624
   sits after the `#navDispatchInFlight` short-circuit at 1602, so an external
   nav superseding the in-flight commit goto never reached it; the queue could
   persist and fire a phantom redirect on a later landing. CONCERN (logic gap).
3. `orchestrator:234-271 / 359-363` - the publication docstring framed the
   publication as state-machine + executor `#progress` only, omitting
   `lastDispatchWasDeepToDeep` (an orchestrator-private handshake field).
   CONCERN (docstring).

## Fixes

- A1: `forwardDeepTarget` now returns null unless `publication.direction ===
'forward'`. A backward deep-to-deep falls through to the cached preview
  panel via `leftPanelPathname`. Preventive e2e: `reproduce-user-bugs.spec.ts`
  Bug 12 augmented to assert the cached SettingsMenuPanel (its Edit Account
  link) renders in the left panel, not the skeleton.
- A2: `progressVelocity = (clampedVelPx * axisSign) / distancePx` with
  `axisSign = axis === 'left' ? -1 : 1`, so the velocity sign is progress-space
  for both axes. Forward tab swipes are now velocity-matched. The seven
  velocity unit tests were rewritten to the physical committing direction.
- A3: the test comments corrected; the suite now pins the axis-aware behavior.
- B1: the orphan-prevention comment rewritten to describe the replay re-entry
  (flag false) and the supersede handling.
- B2: inside the `#navDispatchInFlight` branch, an incoming nav that does not
  match `#dispatchTarget` (an external supersede) now clears
  `#queuedDiscreteNav`. The legitimate own re-entry matches `#dispatchTarget`
  and is unaffected; the existing 1624 clear still covers the post-goto case.
- B3: the publication docstring now names `lastDispatchWasDeepToDeep` as the
  one orchestrator-private field carried for the destination host's handshake.

## Gate outputs (post-fix, independently re-run 2026-07-15)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The one flaky test is `fab.spec.ts:435` (the known CDP-touch class). The three
logic fixes are behavior-relevant; e2e confirms no regression (the count
matches the pre-fix run). A1 has a preventive e2e (Bug 12, verified passing
alone); A2 has the rewritten unit suite; B2 is a defensive race fix verified
by the gate and a structural trace.

R40 audits the post-R39-fix state.

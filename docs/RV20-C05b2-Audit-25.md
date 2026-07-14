# RV20-C05b2 - Audit Round 25

Result: **A FAIL (2 CONCERN); B PASS-WITH-CONCERNS (2 CONCERN).** Counter
stays **0/5**. The pipeline architecture remains sound (verified by both
auditors: singleton orchestrator, one rAF per channel, NavStateMachine
authority, no CSS transition or setTimeout in the animation layer, deleted
legacy hosts, all routes mount the pipeline, the five Known conditions match
the code). Four concerns, all in `nav-pipeline-orchestrator.svelte.ts` and
`route-config.ts`.

## Adjudication of A's finding 1 (the hardcoded 'back')

A flagged `#armSettleEaseFromGesture` hardcoding the settle `direction` to
`'back'` as a visible logic bug. B flagged the same code in its non-blocking
notes but classified it as invisible. The orchestrator adjudicated by reading
the code:

- The settle title crossfade's `outgoing`/`incoming` titles come from
  `resolveDeepHeaderTitle`, whose `ENTRIES` table contains only deep-page
  routes, NOT the tab roots `/`, `/activity`, `/messages/inbox`.
- A forward gesture release is always a tab-to-tab swipe on the bidirectional
  host, so both titles resolve to `''`. The Header's `titleView` then takes the
  `outgoing === incoming` branch (no directional crossfade), so the direction is
  invisible. B is correct on visibility.
- Backward gesture releases (deep-to-tab, deep-to-deep) carry real titles and
  the direction is `'backward'`, which the hardcoded `'back'` matched.

So it is NOT a visible defect. It IS an architectural inconsistency:
`#armSettleEaseFromGesture` was the only arm path that hardcoded the direction
(`playEnterAnimation` passes `'forward'`; `notifyHeaderState`'s idle-arm and
mid-settle re-arm call `#resolveNavDirection()`; `#accelerateInFlight` preserves
`settleDirection`). Per the architectural-excellence standard the value is now
derived from the gesture direction rather than hardcoded. The change is
behavior-identical for every currently-reachable case (backward maps to
`'back'`; forward tab-to-tab is invisible).

## Merged finding set (4 concerns)

1. **A1 (CONCERN, invisible latent inconsistency)** -
   `nav-pipeline-orchestrator.svelte.ts` `#armSettleEaseFromGesture`: hardcoded
   `'back'`. Fixed: now `pending.direction === 'forward' ? 'forward' : 'back'`.
2. **A2 (CONCERN, comment accuracy + misleading name)** - the `PendingTabExit`
   interface, the `#pendingTabExit` field, and the `#queuedDiscreteNav` field
   docblocks described the slot as a tab-click transition only, but the
   discrete-nav branch sets it for tab-click exits AND forward deep-to-deep
   navs. Fixed: renamed `PendingTabExit` to `PendingDiscreteNav` and
   `#pendingTabExit` to `#pendingDiscreteNav` (interface, field, and the local
   variable in `#onExecutorSettle`), and rewrote all three docblocks to state
   "tab-click exit or forward deep-to-deep".
3. **B1 (CONCERN, comment accuracy)** - the `suppressSlide` comment framed the
   `activeIndex === 0` backward-to-deep behavior as a temporary workaround
   pending a 5b3 deep-snapshot overlay. The spec lists it as a resolved
   deviation (the overlay covers `activeIndex >= 1`; panel 0 has no left
   neighbour to reveal). Fixed: rewritten as the resolution for the
   `activeIndex === 0` geometry.
4. **B2 (CONCERN, comment accuracy)** - `route-config.ts` (two spots) said the
   FAB family enum "dissolves in Cycle 4's all-rAF executor"; the codebase is
   past Cycle 4 and the enum is actively consumed (the FAB layer and the
   orchestrator select the scale driver from it). Fixed: rewritten as a
   permanent consumer config that selects the FAB scale driver.

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    408 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:442,
                                     pre-existing CDP touch flake; passes on
                                     retry within the run)
```

e2e identical to the pre-fix state. No behavioral regression.

R26 audits the post-R25-fix state.

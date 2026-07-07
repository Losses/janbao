# RV20-C05b1 - Audit Round 02 (2-auditor model, with e2e gate)

Second audit round for Cycle 5b1 (post-R1-fix state), clean prompt +
e2e gate. Result: **0/2 PASS** (both PASS-WITH-CONCERNS). Two distinct
concern sets; both real. All fixed.

## Auditor verdicts

- **Auditor A: PASS-WITH-CONCERNS.** One concern: a SECOND
  `effect_update_depth_exceeded` in `SearchScopePager.svelte:88-116`
  (the `/search` scope-publish `$effect` calls `pageCache.capture`
  without `untrack` - same Cycle-2 capture-merge-loop pattern as the
  `+layout.svelte` one fixed in Session 2, but missed). Breaks `/search`
  direct-load hydration (5 `reproduce-user-bugs` e2e timeout). Pre-
  existing (Cycle 2), not introduced by 5b1. One nitpick (journal
  Session-2 "e2e runs" overstatement).
- **Auditor B: PASS-WITH-CONCERNS.** Three concerns: the commit-phase
  pager-publish gap (FAB freezes during the commit slide; orchestrator
  publishes only on live drag, not during the commit rAF); a comment in
  NavPipelineHost overstating the publication; no e2e asserts FAB/Header
  during commit (so the gap was invisible). One nitpick (journal pager-
  publication description).

## Concerns (all blocking, all fixed)

1. **`SearchScopePager.svelte` capture-loop (auditor A):** the `/search`
   scope `$effect` called `pageCache.capture` without `untrack`. Fixed
   (architect): wrapped the capture in `untrack` (mirroring the
   `+layout.svelte` fix). Verified: 13/13 `reproduce-user-bugs` e2e
   pass. (Architect's miss: when fixing the `+layout` instance in
   Session 2, should have grep'd ALL `pageCache.capture`-in-`$effect`
   sites - this was the second instance. Lesson in
   `[[page-cache-capture-loops-effect]]`.)
2. **Commit-phase pager-publish gap (auditor B):** the orchestrator
   published to the pager store only on live drag; during the commit
   rAF the FAB/Header/fractionalIndex froze. Fixed (CMA): added an
   `onTick(progress, liveOffset)` callback to `NavExecutor` (fired each
   commit rAF); the orchestrator's `#onExecutorTick` re-publishes to
   the pager each frame so the FAB transitions during the slide
   (matching GPL). Verified: gesture e2e reports `fabScaleDelta: 1`
   (FAB transitions 0->1 during commit, not frozen).
3. **`NavPipelineHost.svelte:130` comment (auditor B):** said the
   orchestrator publishes "on every commit rAF tick" - false until the
   onTick fix. Now accurate.
4. **Missing FAB-during-commit e2e (auditor B):** extended
   `e2e/messages-back-swipe.spec.ts` to sample the FAB scale each frame
   and assert `fabScaleDelta > 0.1` (catches the freeze).

## What was verified clean

- UNIFY invariant held (no bridge; pilot on NavPipelineHost; no
  selector/intent-mirror/old-mechanism primitives).
- R1's C1 (double-slide) stayed fixed (`reversals: 0` on the gesture
  e2e + tab-click-transition).
- Other routes untouched; broader e2e green.

## State after R2 fixes

check 0/0; lint 0; 423 unit pass; pilot-touching e2e green
(`reversals:0`, `fabScaleDelta:1`); `reproduce-user-bugs` 13/13; broader
sweep green.

Consecutive pass votes: **0** (R2 carried concerns; A's was pre-existing
but still a code-correctness defect, B's was a 5b1 behavior regression).

# RV20-C05b1 - Audit Round 22 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A FAIL (3 concerns); auditor B PASS-WITH-
CONCERNS (3 concerns + 1 nitpick). The architect re-verified every
concern; all are real. The R21 fixes HELD (neither auditor re-flagged
C1-C5). The most serious R22 concern (A-C3) is the SAME family as
R14-R20: the absolute-position helper fixed the gesture's FIRST frame
(onDragStart) but the live-drag loop (onDragMove) still reset progress
to 0 via the threshold mapping, so the track snapped on the 2nd
pointermove when a gesture began mid-transition. Fixed by making the
live-drag continuity-aware.

## Architect gate outputs (post-R22-fix, real)

```
$ bun run check          0 errors / 0 warnings
$ bun run lint           EXIT=0 (prettier clean incl. .md; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    425 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  78 passed (2.6m)
```

## Concerns (all confirmed; all fixed)

- **A-C3 / the live-drag jump (correctness, the R14-R20 family):** the
  helper fixed `onDragStart`'s startProgress, but `#interpretIntent`'s
  onDragMove block computed `trackProgress = thresholdAbsorbed(raw)`
  ABSOLUTE from 0. For a gesture claimed mid-transition at startProgress
  0.7, the 2nd pointermove (raw < 0.2 threshold) reset trackProgress to
  0 -> ~275px snap. `gestureJustStarted` (R20) only skipped the FIRST
  move. Fix: the live-drag is now continuity-aware -
  `trackProgress = startProgress + thresholdAbsorbed(raw) * (1 -
startProgress)` - so the first 20% of drag is absorbed AT the start
  position and the track never snaps back. `startProgress` is carried on
  `PendingGestureTransition`. `gestureJustStarted` is removed (the
  continuity mapping subsumes it). From-rest back-swipe (startProgress=0)
  is unchanged.
- **A-C1 / B-C1 (dead fields + overclaiming docstrings):**
  `PendingGestureTransition` carried `.from / .fromTag / .toTag /
.direction` and `PendingTabExit` carried `.svelteKitType / .chipExit`,
  none read. Trimmed to `{ to, startProgress }` and `{ target }`; the
  docstrings now describe the slots' actual purpose.
- **A-C2 (comment accuracy):** `TAB_CLICK_COMMIT_MS` claimed the exit
  was "indistinguishable" from GPL; the duration matches but the easing
  is the executor's `s(u)=2u-u²`, not CSS's timing function. Reworded.
- **B-C2 (dead code):** `NO_OP_PLAN` (decl + re-export) had no importer.
  Removed.
- **B-C3 (comment accuracy):** `nav-executor.svelte.ts` file docstring
  still listed `onInterrupt` (removed in R21) and said "Cycle 4 shadow
  mode / Cycle 5 wires". Reworded to current language.
- **Nitpick (both):** prettier failed on the journal + audit-21 `.md`
  (my edits). Run `prettier --write`; lint now EXIT=0.

## What R22 verified clean (no re-flag of R21)

Mutual exclusion of pending slots (R21 C1), `preloadData` in chip-exit
(R21 C5), progress-driven LoadingChip (R21 C5), `playEnterAnimation` via
the helper (R21 C4), `onPointerCancel` removal (R21 C2), the
absolute-position start frame (the helper itself). The §5 invariants
(UNIFY, all-rAF, no DOM read-back, velocity-matched commit) all hold.

Consecutive pass votes: **0** (R1-R22 each carried concerns).

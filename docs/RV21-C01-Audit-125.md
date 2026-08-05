# RV21-C01 Audit 125 (R125)

**Date:** 2026-08-05. **Round:** R125. **Votes:** auditor A PASS,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

A PASSed; B BLOCKed on a 5th instance of the over-narrow-characterization
class. A missed it (as R122/R123 missed DragMorphAnchor); B found it. The
round is a BLOCK (any one auditor's concern suffices).

**B's finding (verified by the orchestrator):** `#settleStartProgress`
field docstring (`orchestrator:542-544`) read "The settle progress's start
value on the publication's raw scale (the release position for a
gesture-release settle, 0 for a non-gesture title-change settle)." The
parenthetical covered only 2 of the field's 6 caller paths. The field is
set by `#armSettleEase`'s `startProgress` parameter from 6 callers:

1. `playEnterAnimation` (forward-enter): `0`
2. discrete-nav arm: visual-derived raw at the interrupt -- **0 for
   from-rest, non-zero for a live-drag interrupt**
3. `#armSettleEaseFromGesture` (gesture-release): release raw
4. `#accelerateInFlight` (re-arm): in-flight settle progress -- **non-zero
   when advanced**
5. `notifyHeaderState` mid-settle absorb (re-arm): in-flight settle
   progress -- **non-zero when advanced**
6. idle title-change arm: `0`

Paths 2, 4, 5 were completely unaddressed and can hold a non-zero,
non-release value. The orchestrator independently confirmed path 2
(`#startProgressFromCurrentVisual(plan)` at line 2692, passed at line 3055)
is the visual-derived interrupt raw, and paths 4/5 pass
`this.#stateMachine.settleProgress`.

## Same class, different phrasing (why sweeps kept missing it)

This is the same class as R120 (`startMorph`), R121 (`#atRestMorph`
justification), R124 (`DragMorphAnchor`). Each instance uses a different
phrasing, so lexical greps for one neighborhood (`terminal`, `startMorph`,
`DragMorphAnchor`) never matched this field. B found it by sweeping
parenthetical "X for case Y, Z for case W" characterizations across ALL
state-field docstrings and re-deriving each against its full caller set.

## Fix

Rewrote the parenthetical to cover all 6 paths: "the settle's raw-scale
start value at the settle-arm instant: the release raw for a
gesture-release; the visual-derived raw at the interrupt for a discrete-nav
arm (0 for a from-rest tab-click); the in-flight settle progress for an
accelerate / mid-settle-absorb re-arm; 0 for a forward-enter or an idle
title-change."

## Orchestrator proactive sweep -- 2nd fix (rawStart)

The orchestrator then ran a broad proactive grep for the same class
(parenthetical "X for case Y, Z for case W" characterizations) across the
orchestrator's field/interface docstrings to break the one-per-round
cycle. This surfaced a 2nd site neither auditor flagged:

- `orchestrator:144-145` (`PendingGestureTransition.rawStart`) -- "the
  commit's last published raw for a re-grab, 0 for from-rest." `rawStart`
  is actually `#startProgressFromCurrentVisual(plan)` -- the NEW plan's
  progress at the current visual position (per the authoritative inline
  comment at line 1918). For a gesture-during-forward-enter (a real case
  per `#dragMorphAnchor`: a drag taking over an in-flight ENTER settle),
  the value is the enter settle's visual-derived raw, NOT "the commit's"
  raw. "the commit's last published raw" excludes enter/discrete-nav-settle
  re-grabs. Fixed: "the new plan's progress at the current visual position
  for a re-grab, 0 for from-rest" -- accurate for every in-flight-takeover
  source, and consistent with the inline comment 5 lines below the
  construction site.

## Orchestrator sibling sweep

Checked every settle-arm and publication field docstring for the same
pattern:

- `#settleTargetProgress` ("1 for commit / click, 0 for cancel") -- correct
  (accelerate/absorb preserve the prior target, itself 1 or 0). B concurs.
- `#settleEasedFraction`, `#settleStartTs` -- single-concept, not multi-path.
- `#settleAwaitTitle` -- boolean true-state, accurate.
- `settleProgress` (R114-fixed), `settleMorphFraction`, `settleLatched`,
  `settleDirection` -- accurate.
- The `EnterFabAnchor` / `SearchAnchor` "Five reach paths" docstrings
  (header-probe.ts, fab-scale.ts) enumerate all paths with per-path values
  -- comprehensive, not over-narrow.

`#settleStartProgress` (B) and `rawStart` (orchestrator proactive sweep)
were the two over-narrow sites this round.

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
comment-only change.

## Disposition

Counter after R125: 0/5. The over-narrow-characterization class has now
produced 5 instances (R120, R121, R124, R125, plus the drag-terminal
lexical sub-class). Each deep audit that sweeps a NEW phrasing neighborhood
finds one more. To converge, sibling sweeps must cover every
multi-path-value docstring by RE-DERIVING against the caller set, not by
grepping one lexical neighborhood.

**No git mutation.** No commits, no branches, no pushes.

# RV21-C01 Audit 76 (R76)

**Date:** 2026-08-01. **Round:** R76. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): `#settleMorphFraction` "Returns 0 at rest" is literally false

**F1:** `orchestrator:492-498` (`#settleMorphFraction` docstring) claimed
"Returns 0 at rest". The helper returns `#settleEasedFraction`, which is 0
only at arm (`:3302`) and at `unmount` (`:1414`); the tick advances it
toward 1 (`:3337`) and neither the tick's terminal branch nor
`#endSettleEase` resets it, so after any completed settle the system is at
rest (`settleActive === false`) and the field holds 1. "Returns 0 at rest"
is false in the common case (any session with at least one completed
settle). Rewrote to state the field holds its last tick value at rest (1
after a completed settle, until the next arm or `unmount` resets it) and
the Header's at-rest branch does not read it.

Sibling sweep: every "Returns <value> at <state>" claim in the layer
re-checked (`hideProgress`, `#rawDragFraction`,
`#startProgressFromCurrentVisual`, `progressAtTranslateX`) -- all accurate
(pure functions or explicit guards). No sibling.

## Auditor B finding (CONFIRMED): `#cancelAllAnimationEases` "Called from" under-enumerates (2 vs 3 paths)

**F1:** `orchestrator:3876-3879` (`#cancelAllAnimationEases` docstring)
claimed 2 call paths (`#beginGesture` re-grab + the discrete-nav path),
but there are 3 call sites. The omitted `:2515` site is the
`if (!isNavPipelineRoute(to))` cleanup inside `onSvelteKitBeforeNavigate`'s
non-tab-root / non-deep-to-deep early-return branch: a nav to a
non-pipeline route that leaves the orchestrator's active window, where an
in-flight settle would strand the Header on its stale latched endpoint
(its own comment at `:2510-2518`). This is a distinct purpose from the
`:2600` discrete-nav interruption and the `:1813` re-grab, and the
parenthetical "(a tab-click or deep-to-deep nav ...)" excludes it. Rewrote
to enumerate all three paths. (Distinct from R74's `resetPagerStore`
dismissal: there the two host `$effect`s shared one purpose; here the
three calls have distinct purposes.)

## Orchestrator verification

Independently verified both before fixing. A-F1: traced
`#settleEasedFraction` (init `:562`, arm `:3302` = 0, reduced-motion
`:3314` = 1, tick `:3337` = eased, unmount `:1414` = 0; no reset at settle
completion). B-F1: confirmed the 3 call sites via grep and read the
`:2510-2518` context (pipeline-exit cleanup, distinct purpose). Re-ran
both sibling sweeps; no missed siblings.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R76: 0/5. Both auditors filed out-of-scope process notes
that the loop has spent roughly eleven consecutive rounds on
comment-accuracy in this heavily-commented orchestrator file; the code
behavior (Fix A/B/C/D), the gate, and the §5 invariant have been stable
for many rounds. Per the architect directive the loop continues while
real defects remain.

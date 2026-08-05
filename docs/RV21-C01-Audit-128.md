# RV21-C01 Audit 128 (R128)

**Date:** 2026-08-05. **Round:** R128. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

A and B BLOCKed on TWO DIFFERENT findings (both the over-narrow-rationale
sub-class). Counter stays 0/5.

## Finding A -- `#priorTerminalSearchProgress === 0` "third clause" rationale

`orchestrator:1316-1321` (playEnterAnimation inline comment) + sibling
`header-probe.ts:189-194` (SearchAnchor path-1 docstring) justified
`#priorTerminalSearchProgress === 0` for a non-search pipeline commit
landing by citing `#searchProgressAtSettleInstant`'s THIRD (at-rest)
clause. The third clause is what fires for a from-rest tab-click and a
deep→deep discrete nav. But for a GESTURE-RELEASE commit,
`#armSettleEaseFromGesture` re-seeds `#searchAnchor = {0,0}`, so at
`#onExecutorSettle` (line 2254, where the stash is set via the helper)
the FIRST clause (`settleActive && searchAnchor !== null`, line 4455)
fires and lerps to 0 -- NOT the third. The value (0) is correct for all
paths; the cited REASON (third clause) holds for only some.

Fixed (both sites): replaced the clause-specific rationale with the
two-mechanism form -- "returns 0 (neither side is search -- via the
at-rest clause, or a re-seeded `{0,0}` settle-anchor lerp for a
gesture-release commit)."

## Finding B -- `#armSettleEase` `durationMs` "no slide to track" rationale

`orchestrator:3208-3210` (`#armSettleEase` docstring) lumped the
`notifyHeaderState` mid-settle absorb arm and the idle title-change arm
under "(200ms; no slide to track)." The rationale holds for the idle arm
(nav landed, no slide) but NOT for the absorb arm, which fires mid-enter
WHILE THE SLIDE IS IN FLIGHT (the absorb arm's own inline comment at
4122-4124 describes "an enter settle being re-armed ... mid-enter"). The
parallel comment at 527-540 states the same parameter for the same arms
WITHOUT the "no slide to track" rationale (just "the default
`TITLE_CROSSFADE_MS` for the absorb and idle title-change arms") --
confirming the rationale at 3208-3210 is the defective addition.

Fixed: "(200ms; a fixed crossfade duration independent of any in-flight
slide)" -- accurate for both arms (the absorb arm runs its 200ms
concurrently with the in-flight slide; the idle arm runs it with no slide).

## Why R127's proactive sweep missed these

R127's sweep targeted signal-DEFINITIONAL parentheticals (appositions).
These two findings are RATIONALE sub-properties inside multi-line
explanations (a "because X clause" and a "no slide to track" aside), not
parenthetical appositions. Each sub-property type (value / rationale /
apposition) needs its own re-derivation pass.

## Verify

`bun run check` 0/0; `prettier --check` clean on both edited files; no
U+2014 em-dash; comment-only changes.

## Disposition

Counter after R128: 0/5. The over-narrow-rationale class has now produced
instances across R120 (value), R121 (justification), R124 (apposition),
R125 (value + value), R127 (rationale + apposition), R128 (rationale +
rationale). Convergence requires re-deriving every sub-property type of
every multi-path field's docstring against the full path set.

**No git mutation.** No commits, no branches, no pushes.

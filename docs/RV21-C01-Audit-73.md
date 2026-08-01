# RV21-C01 Audit 73 (R73)

**Date:** 2026-08-01. **Round:** R73. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A findings (CONFIRMED): helper-docstring call-site enumeration undercounts

A new defect class (call-site enumeration completeness of "Used by"
claims), distinct from the R70-R72 null-condition class.

**F1:** `orchestrator:4276-4281` (`#morphAtSettleInstant` docstring)
"Used by the mid-settle absorb re-arm in `notifyHeaderState` and
`#accelerateInFlight`" listed 2 callers but the helper has 3. The omitted
site is the `#beginGesture:1751` re-grab capture that seeds
`#dragMorphAnchor.morph` (the parallel of `#fabScaleAtSettleInstant`'s
beginGesture capture of `#dragFabAnchor.scale`). The sibling helpers
`#fabScaleAtSettleInstant` (6 sites) and `#searchProgressAtSettleInstant`
(5 sites) enumerate their beginGesture captures; morph did not. Rewrote
to enumerate all three and distinguish the drag-anchor purpose (seed the
shift formula) from the re-arm purpose (`startMorph` continuity).

**F2:** `orchestrator:1322-1327` (`#atRestMorph` docstring) "Used by the
non-gesture settle arm sites (forward-enter, discrete-nav, idle
title-change)" listed 3 sites but the helper has 6, and the "non-gesture"
qualifier is wrong (`#armSettleEaseFromGesture:3484-3485` is a
gesture-release site). Omitted: `#armSettleEaseFromGesture`,
`#dragMorphAtSettleTakeover:3608`, `notifyHeaderState` absorb `:4043`.
Rewrote to enumerate all six and drop the "non-gesture" qualifier.

## Auditor B finding (CONFIRMED): `#searchProgressAtSettleInstant` null-condition under-describes

**F1:** `orchestrator:4354-4355` (`#searchProgressAtSettleInstant`
docstring) primary "Returns null when no transition is in flight" named
only the `!inFlight` short-circuit, omitting the `#mountInputs === null`
and `toPathname === null` null-cases (body `:4390-4393`). The parallel
`#fabScaleAtSettleInstant` (R72-fixed) enumerates its null-condition
groups. Rewrote to enumerate all three null-cases.

Auditor A and auditor B both examined this docstring but for different
criteria: A verified the call-site count (5/5, complete); B verified the
null-condition sentence (incomplete). Both hold.

## Orchestrator-additional fix

`:1304-1305` inline comment "the helper short-circuits to null only when
no transition is in flight" was surfaced in auditor B's out-of-scope note
and waved as "contextually accurate". Orchestrator verified the "only" is
a literal overclaim (a general statement about the helper, not
context-scoped -- the helper has three null-cases, not one) and rewrote
to "at a commit terminal the helper does not short-circuit to null
(in-flight, `#mountInputs` set, `toPathname` resolved)". The parallel
`:4068-4069` "only null-guard skip" was left unchanged: it is genuinely
scoped to the absorb path, where `fromPathname` / `toPathname` are always
resolved so only `!inFlight` can fire.

## Orchestrator verification

Independently re-ran the comprehensive "Used by" enumeration sweep across
the layer and per-helper `this.#fn(` counts. Only `#morphAtSettleInstant`
(2/3) and `#atRestMorph` (3/6) under-enumerate; every other claimant is
complete (`#cancelSettleEaseRaf` 3/3, `#cancelTapScrubRaf` 3/3,
`#dragMorphAtSettleTakeover` 2/2, `#fabScaleAtSettleInstant` 6/6,
`#searchProgressAtSettleInstant` 5/5 call-sites). No missed siblings in
either class.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R73: 0/5.

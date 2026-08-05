# RV21-C01 Audit 126 (R126)

**Date:** 2026-08-05. **Round:** R126. **Votes:** auditor A PASS,
auditor B PASS. **Counter after: 1/5.**

## Outcome

Double-PASS. First consecutive pass after R125's BLOCK. Both auditors did
COMPREHENSIVE multi-path-value re-derivation -- not just the R120-R125
fixes, but every field/parameter/interface-property docstring set by
multiple callers -- and found zero in-scope concerns.

## Comprehensive re-derivation (both auditors)

A re-derived (against full caller sets): `#settleStartProgress`, `rawStart`,
`#atRestMorph`, `startMorph`, `DragMorphAnchor`, `destMorph`,
`#commitStartRaw` (3 cases), `#lastLandWasPipelineCommit` (5 clear sites),
`#lastDispatchWasDeepToDeep` (5 sites), `#gestureToTabIndex` (2 sites),
the anchor clear sites, `EnterFabAnchor` (5 paths), `SearchAnchor` (5
paths), `#fabScaleAtSettleInstant` (6), `#searchProgressAtSettleInstant`
(6), `#morphAtSettleInstant` (3). B independently walked every state-field
docstring and the 6 `#armSettleEase` arm paths. All accurate.

The depth here is the key: prior PASS rounds (R122, R123) missed the
DragMorphAnchor (R124) and settleStartProgress/rawStart (R125) residuals
because they re-derived a NARROWER field set. R126's auditors broadened
the re-derivation to essentially every multi-path field in the layer, and
found nothing -- the strongest signal yet that the over-narrow-characterization
class is genuinely exhausted.

## Class exhaustion signal

Both auditors explicitly grepped for the class with multiple phrasings
(parenthetical "X for case Y", universal "every X" / "always" / "never",
"for X / for Y", hyphenated and apostrophe drag-terminal / interrupt-instant
forms) and read every hit. No remaining instance.

## Prior fixes verified intact (both)

R124 (DragMorphAnchor symmetric-ref), R125 (`#settleStartProgress` 6 paths,
`rawStart` visual-derived). All in place and accurate.

## §5 + gates

No CSS `transition:` or animation-layer `setTimeout`. Three disjoint rAF
channels. Fix A/B/C/D match spec. `bun run check` 0/0; `bun run lint` exit 0;
`bun test src/lib/stores src/lib/utils` 398/0; prettier clean; no U+2014;
no TODO/FIXME/HACK; no past-state markers.

## Out-of-scope observations (both, non-blocking)

- `DualColumnLayout.svelte` CSS transitions (desktop slogan / drawer) --
  separate UX, out of the page-transition layer (carried from R122).

## Verify

No code change this round. Gates green.

## Disposition

Counter after R126: 1/5. Four more consecutive double-PASSes needed
(R127, R128, R129, R130) to close at 5/5.

**No git mutation.** No commits, no branches, no pushes.

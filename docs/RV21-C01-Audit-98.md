# RV21-C01 Audit 98 (R98)

**Date:** 2026-08-03. **Round:** R98. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Two findings: the fourth iteration on the "startMorph === destMorph"
comment, and a variable naming issue.

## Auditor A (CONFIRMED): R97-B "non-saturated" qualifier excludes saturated tab-ness-preserving bm-following

**F1** `Header.svelte:284` + `header-probe.ts:60` -- the R97-B fix said
"for a non-saturated bm-following release (raw_release < 1) the lerp
eases". Wrong for a saturated (raw_release=1) tab-ness-PRESERVING
bm-following commit (centerTab thread -> tab-root: startMorph=0,
destMorph=1, the lerp eases). Fixed: replaced shape enumeration with the
fundamental condition -- "the lerp eases the morph unless
`natural(raw_release) === destMorph` (a constant hold -- e.g. static-
morph shapes, or a saturated commit where `natural(1) =
atRestMorph(destination)` by construction)." This approach can't miss an
edge case because it states the condition, not a list of shapes.

## Auditor B (CONFIRMED): `targetSearchAnchor` variable naming

**F1** `Header.svelte:196` -- the local `targetSearchAnchor` is bound to
`orchestrator.dragMorphAnchor` (a morph-axis anchor) but the name contains
"Search" (the layer's established namespace for search-axis anchors; the
type `SearchAnchor` exists at `header-probe.ts:255`). Renamed to
`morphAnchor` (axis-clear, matching the sibling `anchor` at :249).

## Orchestrator verification

A: confirmed centerTab->tab-root saturated commit has startMorph=0,
destMorph=1 (lerp eases). The fundamental condition covers all cases
without enumeration. B: confirmed the naming outlier (the other 4 anchor
locals follow the morph/search convention). `bun run check` 0/0; prettier

- em-dash clean.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean. A-F1
comment-only; B-F1 a code change (variable rename, no behavior change).

## Disposition

Counter after R98: 0/5. The "startMorph" comment's fourth iteration uses
the fundamental condition instead of shape enumeration -- this approach
should converge (no edge cases to miss). B verified the R98-A fix
accurate.

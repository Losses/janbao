# RV21-C01 Audit 99 (R99)

**Date:** 2026-08-03. **Round:** R99. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Two findings: the fifth iteration on "startMorph === destMorph" (now
trivially correct), and a separate "collapse to a constant"
overgeneralization in the same comment block.

## Auditor A (CONFIRMED): R98-A "fundamental condition" wrong for static-morph

**F1** `Header.svelte:284` + `header-probe.ts:60` -- the R98-A condition
`natural(raw_release) === destMorph` was wrong for static-morph shapes:
for targetIsSearch, `startMorph = atRestMorph(outgoing) = 1`, NOT
`natural(raw_release)`. Fixed with the trivially-correct condition:
"the lerp is a constant hold when `startMorph === destMorph`; otherwise
it eases the morph." This references the actual latched values (not a
formula substitution) and is universally correct.

## Auditor B (CONFIRMED): "collapse to a constant" overgeneralization

**F1** `Header.svelte:287-291` -- the settle-branch comment said
"Reading `settleProgress` directly here would collapse to a constant for
shapes where `outgoingHasTabs === incomingHasTabs`". Wrong for the
non-saturated case: settleProgress starts at settleStartProgress (not 0),
so the lerp starts partway and SNAPS (not collapses to a constant). The
collapse-to-constant only occurs under a different counterfactual
("without a captured startMorph") which the header-probe.ts:28-30 sibling
correctly uses. Fixed: "start the lerp partway (at settleStartProgress,
not 0) and snap the icon plus layer translateY in one rAF frame."

## Orchestrator verification

A: confirmed targetIsSearch from-rest at raw=0.5 has startMorph=1,
destMorph=1 (constant hold) but natural(0.5)=0.5 ≠ 1 (the R98 condition
was false). B: confirmed centerTab->tab-root commit at raw=0.7: morph
would jump from 0.3 to 0.79 (snap, not constant) if settleProgress were
used. `bun run check` 0/0; prettier + em-dash clean.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R99: 0/5. The "startMorph" comment's fifth iteration uses
the trivially-correct condition (`startMorph === destMorph`) -- it can
never be wrong because it references the actual latched values, not a
formula.

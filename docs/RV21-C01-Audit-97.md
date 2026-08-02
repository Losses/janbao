# RV21-C01 Audit 97 (R97)

**Date:** 2026-08-03. **Round:** R97. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Three iterations on the "startMorph === destMorph" comment (R96 → R97-A →
R97-B), each catching an edge case the previous scoping missed.

## Auditor A (CONFIRMED): R96 "cancels and same-tab-ness" too broad

**F1** `Header.svelte:284` + `header-probe.ts:60` -- R96 scoped
"`startMorph === destMorph`" to "cancels and same-tab-ness shapes". Wrong
for bm-following same-tab-ness shapes (centerTab thread -> tab-root):
startMorph = natural(raw_release) which differs from destMorph when
raw_release > 0. Fixed: scoped to "shapes where the drag-branch morph is
static (targetIsSearch, deep-to-deep, non-centerTab tab-to-tab)".

## Auditor B (CONFIRMED): R97-A fix still overclaims at saturation

**F1** `Header.svelte:284` + `header-probe.ts:60` -- the R97-A fix said
"for bm-following shapes startMorph differs". Wrong at saturation
(raw_release = 1): natural(1) = atRestMorph(destination) by construction
for deep -> tab (1=1), tab -> deep (0=0), and centerTab -> deep (0=0)
commits. Only centerTab -> tab-root differs at saturation (0 vs 1). The
orchestrator's own case-3 docstring (`:2855-2866`) acknowledges this
saturated equality. Fixed: added "or on a saturated (raw_release = 1)
tab-ness-changing commit where natural(1) = atRestMorph(destination) by
construction; for a non-saturated bm-following release (raw_release < 1)
the lerp eases the morph".

## Orchestrator verification

Independently verified both iterations. A: confirmed centerTab thread ->
tab-root cancel at raw=0.3 has startMorph=0.7, destMorph=1 (animates).
B: confirmed deep -> tab saturated commit has startMorph=1, destMorph=1
(constant hold); centerTab -> tab-root saturated commit has
startMorph=0, destMorph=1 (animates). The final scoping accurately
distinguishes all cases.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R97: 0/5. Three iterations on a single comment illustrate
the convergence bar's strictness: each scoping must capture EVERY edge
case (static shapes, bm-following shapes, saturated releases, tab-ness-
changing vs same-tab-ness). The orchestrator's own case-3 docstring
(`:2855-2866`) was the authoritative reference all along.

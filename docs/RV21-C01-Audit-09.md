# RV21-C01 Audit 09 (R9)

**Date:** 2026-07-28. **Round:** R9. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0.

R9-A found the FAB anchor capture helper is incomplete (doesn't mirror the FAB
layer's overriding branches); R9-B found a FAB stash leak + stale comments from
R8's destMorph change.

## R9-A F1 (§5, primary): FAB anchor capture doesn't mirror the FAB layer's branches

`#fabScaleAtSettleInstant` (`nav-pipeline-orchestrator.svelte.ts:3601-3607`)
computes `fabScale(pub.progress, fromHasFab, toHasFab)` (the natural formula),
but `FloatingActionButtonLayer.svelte`'s scale derivation has FIVE branches that
override the natural formula during a settle: boundary (`from === to` →
`1 - pub.progress * BOUNDARY_RUBBER_BAND_FACTOR`), suppressed
(`distance === 0 && toPathname.tag === 'tab'` → `fromHasFab ? 1 : 0`),
enterAnchor (lerp from `enterFabAnchor`), dragAnchor (shift), default (natural).
The helper matches only the default. So a re-grab during a boundary-cancel /
suppressed / enter settle captures an anchor.scale that disagrees with the
displayed FAB → the dragAnchor branch snaps the FAB. Probe-verified on
boundary-cancel re-grab: 0.29-0.41 FAB snap. Siblings: within-tab pagination
cancel re-grab (suppressed branch), enter-settle re-grab (enterAnchor branch).

**Fix:** make `#fabScaleAtSettleInstant` mirror the FAB layer's full branching
(read `#enterFabAnchor`, the plan's `pageTrack.distance`, `from === to`, etc.),
OR extract the FAB scale computation into a shared pure function both the FAB
layer and the helper call.

## R9-B F1 (§5/correctness): `#priorTerminalFabScale` leaks across a non-pipeline commit

`#onExecutorSettle` stashes `#priorTerminalFabScale` unconditionally on a commit
(L2034), but the non-pipeline-target branch (L2057-2060) does not clear it,
and `releaseInputs` / `configure` don't either. So a commit to a non-pipeline
route (e.g. `/entry/login`) leaks the stash; the next `playEnterAnimation` on a
pipeline route seeds a stale `#enterFabAnchor`, producing a wrong FAB animation
(FAB stays hidden instead of sliding out). The field docstring's claim that
`#landAtRest` covers the non-pipeline case is wrong.

**Fix:** guard the stash with `isNavPipelineRoute(target)` OR clear it in the
non-pipeline branch. Rewrite the docstring.

## R9-A F4 + R9-B C1-C5 (comments): stale targetIsSearch / destMorph comments after R8

R8 changed `targetIsSearch`'s `destMorph` from `startMorph` (hold) to
`atRestMorph(outgoingHasTabs)` (ease toward source's at-rest), and added the
anchor-aware `dragMorphWasStatic` branch. Multiple comments still describe the
pre-R8 hold / non-anchor behaviour:

- `nav-pipeline-orchestrator.svelte.ts:2953-2966` (duplicate pre-R8 destMorph block).
- `Header.svelte:167-174` (targetIsSearch skip: "HOLDs the morph").
- `Header.svelte:277-281` (settle branch: "destMorph = startMorph, a hold").
- `header-probe.ts:47-60` (destMorph docstring: "destMorph = startMorph").
- `nav-pipeline-orchestrator.svelte.ts:3018-3046` + `:2924-2941` + `:2592-2603`
  (`#dragMorphAtSettleTakeover` docstring + sibling comments: omit the
  anchor-aware `dragMorphWasStatic` branch).
- `nav-pipeline-orchestrator.svelte.ts:1604-1616` + `:3594-3600`
  (`#fabScaleAtSettleInstant` comments: claim it mirrors the FAB layer, false).

## Counter after R9: 0/5.

## Fix for R10 (CMA)

1. R9-A F1-F3: make `#fabScaleAtSettleInstant` mirror the FAB layer's full
   branching (or extract a shared pure function). Add preventive no-snap guards
   for the boundary-cancel re-grab + enter-settle re-grab.
2. R9-B F1: clear/guard `#priorTerminalFabScale` on non-pipeline commits.
3. R9-A F4 + R9-B C1-C5: rewrite the stale comments to the R8 behaviour.

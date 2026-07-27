# RV21-C01 Audit 08 (R8)

**Date:** 2026-07-27. **Round:** R8. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0;
full e2e 225/0 (after the R7 fix).

R8-A found three real §5 defects (morph + FAB at the opposite-direction re-grab
and the commit-to-enter boundary); R8-B found one stale comment.

## R8-A F1 (§5): morph snap at opposite-direction re-grab into `targetIsSearch`

`Header.svelte:178-180` - the `targetIsSearch` short-circuit returns
`currentHasTabs ? 1 : 0`, BEFORE the `bm !== null` branch that applies
`orchestrator.dragMorphAnchor`. So an opposite-direction re-grab whose new
gesture is a forward-swipe-to-`/search` drops the anchor: the morph snaps from
the prior settle's value (~0.34) to 1 in one frame (26px rootLayer, 119deg
burger; probe-verified at t=498ms). Reachable on `/messages/inbox` (last tab)
after a back-swipe toward `/bookmarks` is interrupted by a forward re-grab toward
`/search`.

**Fix:** when `dragMorphAnchor` is set, return `anchor.morph` instead of the
static at-rest (collapses to the existing behaviour when no anchor is in flight).

## R8-A F2 (§5, sibling): morph snap at opposite-direction re-grab into bm=null tab-to-tab

`Header.svelte:238` - the `bm === null` fallback returns
`currentHasTabs ? 1 : 0`, also bypassing the anchor. Reachable when a re-grab's
new gesture flips the publication rule to tab-to-tab (bm=null) while the prior
settle's morph was mid-flight. Same fix (honor the anchor).

## R8-A F3 (§5): FAB scale snap at opposite-direction re-grab

`FloatingActionButtonLayer.svelte:126` reads `publication.progress` directly,
which snaps on the raw-scale flip of an opposite-direction re-grab (from
`settleProgress` to `rawStart = 1 - settleProgress`). The FAB has no anchor
compensation (the morph's `dragMorphAnchor` doesn't cover it). Probe-verified:
FAB snaps 0.89 in the re-grab frame.

## R8-A F4 (§5): FAB scale snap at commit-to-enter handoff

Same FAB reader. At the boundary between a forward-swipe's commit (progress → 1)
and the destination's `playEnterAnimation` (progress = 0), `publication.progress`
resets 1 → 0, so for a from-only-FAB shape the FAB snaps from
`fabScale(1,true,false)=0` to `fabScale(0,true,false)=1` in one frame
(probe-verified at t=1299ms). Reachable on `/messages/inbox` → `/search` (Bug 3)
and `/` → `/activity`.

**Fix for F3/F4:** the FAB needs continuity across the raw-scale flip (re-grab)
and the commit-to-enter reset - either a `fabAnchor` captured at `#beginGesture`

- the commit-to-enter boundary (analogous to `dragMorphAnchor`), or a continuous
  FAB-progress signal the orchestrator publishes. The simpler path matches the
  morph's anchor pattern.

## R8-B F1 (comment): fab-boundary-swipe-sync spec stale after Fix C

`e2e/fab-boundary-swipe-sync.spec.ts` preamble + test name + body claim the
last-tab forward swipe is a "void-swipe rubber-band" toward a "non-existent next
tab". Fix C wired `#nextTabTarget` to resolve `/search` for the last tab, so the
gesture is a real navigation to `/search` (slide suppressed via the third
`suppressSlide` case; FAB animated via `fabScale`, not the boundary rubber-band
formula). The test passes but the commentary is wrong. Rewrite to the
forward-swipe-to-`/search` framing.

## Counter after R8: 0/5.

## Fix for R9 (CMA)

1. F1/F2: the `targetIsSearch` and `bm===null` drag-branch short-circuits honor
   `dragMorphAnchor` (return `anchor.morph` when set).
2. F3/F4: FAB continuity across the opposite-direction re-grab and the
   commit-to-enter reset (a `fabAnchor` or continuous FAB-progress signal).
3. R8-B: rewrite the fab-boundary-swipe-sync spec commentary.
4. Preventive no-snap guards: sample `rootLayerTy`/`burgerRot`/`fabScale` across
   an opposite-direction re-grab on the bidirectional tab host; sample `fabScale`
   across the commit-to-enter handoff.

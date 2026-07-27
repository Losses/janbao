# RV21-C01 Audit 07 (R7)

**Date:** 2026-07-27. **Round:** R7. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0;
full e2e 224/0 (after the R6 fix).

R7-B found a real §5 snap (the TITLE spans at the drag-to-discrete-nav
handoff); R7-A found two "any host" comment inaccuracies. Both confirm the
morph continuity (R5/R6) is sound.

## R7-B F1 (§5, primary): title-span snap at the drag-to-discrete-nav handoff

The discrete-nav settle arm (`nav-pipeline-orchestrator.svelte.ts:2505`) calls
`this.#armSettleEase(latched, 0, 1, true, settleDirection, commitDurationMs)` -
the literal `0` is `startProgress`. The gesture-release arm (L2842) passes
`this.#publication.progress` (the live raw) for the same parameter. The title
spans read `settleProgress` (the raw-scale rAF value over
`[settleStartProgress, settleTargetProgress]`); with `startProgress = 0` the
settle's `settleProgress` starts at 0, not the drag's live raw (~0.37 mid-drag),
so the spans' parent `translateY` snaps ~15px in one rAF frame. The morph itself
is continuous (R5's `liveDragMorph` capture fixed the morph tier); only the
title tier was missed. Verified on `/profile/password` back-swipe interrupted by
`__e2eGoto('/')`: outgoing/incoming title `translateY` jump ~14.66px, plus a
~0.37 raw-scale phase desync between the slide and the title crossfade for the
whole settle.

**Fix:** pass the visual-derived `startProgress` (already in scope at L2335 via
`#startProgressFromCurrentVisual`) instead of the literal `0`:

```ts
this.#armSettleEase(latched, startProgress, 1, true, settleDirection, commitDurationMs);
```

The from-rest tab-click path collapses to `startProgress = 0` (no live drag), so
Bug 7's behaviour is preserved. Sibling sweep (R7-B): only the discrete-nav site
is defective; `playEnterAnimation`, `#armSettleEaseFromGesture`,
`#accelerateInFlight`, the mid-settle absorb, and the idle title-change arm all
pass the correct start value.

Add a preventive no-snap guard sampling the title spans' `translateY` (the
`div.absolute.inset-0.flex.items-center` children of the deep title layer) across
the deep->deep SPA drag-to-discrete-nav handoff.

## R7-A F1 + F2 (comments): publication-rule comments overclaim "on any host type"

- `src/lib/components/organisms/Header.svelte:187-196`: "the only null
  publication is a tab-to-tab swipe ... on any host type" - false; a centerTab
  thread -> tab-root swipe is on a NavPipelineHost and pill-maps both endpoints
  to Messages, but the centerTab branch publishes `rawDragFraction` end to end.
- `src/lib/stores/mobile-pager.svelte.ts:14-29`: the `backMorph` contract says
  "tab-to-tab on ANY host" - same inaccuracy.

Both are the same class: "any host" should be "non-centerTab host types" (the
centerTab exception is documented in the surrounding sentences but contradicted
by the "any host" phrasing). R5 flagged this and downgraded it incorrectly; R7-A
re-flagged it correctly. Fix: tighten "any host" to "non-centerTab host types".

## Counter after R7: 0/5.

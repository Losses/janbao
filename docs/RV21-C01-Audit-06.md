# RV21-C01 Audit 06 (R6)

**Date:** 2026-07-27. **Round:** R6. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0;
full e2e 222/0 (after the R5 A-F1 proper fix).

R6-A found ONE stale comment; R6-B found a REAL §5 snap INTRODUCED by the R5
A-F1 "proper fix". Both auditors confirmed the rest of the morph-continuity class
(cancel-slide, pointercancel, re-grab reverse, FAB across /search, the flagged
/search-target inconsistency) is behaviourally sound - R6-A's probe of the
`/search` discrete-nav target showed it is structurally unreachable (the
discrete-nav arm does not run for `/search` targets).

## R6-B F1 (§5, the primary defect): morph snap for a SATURATED drag interrupted by a tab-ness-changing discrete nav

The R5 A-F1 fix changed the discrete-nav settle-arm condition from
`outgoingHasTabs !== incomingHasTabs` to `liveDragMorph !== destMorph`
(`nav-pipeline-orchestrator.svelte.ts:2457`). That condition is necessary but
NOT sufficient: when a saturated drag's terminal morph coincidentally equals the
destination's at-rest morph (every tab-ness-changing shape at raw=1), the
condition is false and the arm is SKIPPED. With the arm skipped the morph
derivation falls through to its at-rest branch, which reads `currentHasTabs` of
the SOURCE route (the URL has not changed yet) and returns the SOURCE's at-rest
morph, which disagrees with the drag's terminal morph -> one-frame snap
(180deg icon, 40px tab-bar). Verified empirically on two siblings:
`/messages/<id>` (saturated back-swipe) interrupted by `goto('/bookmarks')`
(centerTab/tab -> deep, snap 0 -> 1); `/profile/settings` (saturated back-swipe)
interrupted by `goto('/messages/inbox')` (deep -> tab, snap 1 -> 0).

**Fix:** the arm must also fire when the live drag's terminal morph differs from
the SOURCE's at-rest (the value the at-rest branch would return if the arm is
skipped):

```ts
const sourceRest = this.#atRestMorph(outgoingHasTabs);
if (liveDragMorph !== sourceRest || liveDragMorph !== destMorph) {
	/* arm */
}
```

The first clause covers the saturated tab-ness-change case (and any drag that
advanced the morph away from the source's rest); the second preserves R5's
same-tab-ness + live-drag case and the from-rest tab-ness-change case. The
from-rest same-tab-ness shape (deep->deep, non-centerTab tab-to-tab) collapses to
equality on both clauses and still skips (the idle title-change arm handles the
title crossfade).

Add a preventive no-snap guard for the saturated shape (both directions): fully
saturate a back-swipe (drag >= viewport width so raw clamps to 1), fire
`__e2eGoto` to a tab-ness-changing target via the SAME CDP session's
`Runtime.evaluate` between the last `touchMove` and `touchEnd`, assert
`maxFrameJumps < {burger: 35deg, root: 15px}`.

## R6-A F1 (comment): the discrete-nav arm's path-2 enumeration

`nav-pipeline-orchestrator.svelte.ts:2403-2413` lists "a deep->deep drag
interrupted by a deep->deep nav" as a path-2 reach case, but that shape SKIPS
the arm (deep->deep morph is hardcoded 0, so `liveDragMorph === destMorph ===
sourceRest === 0`). The second example ("a tab->tab swipe interrupted by a
tab-click") is likewise imprecise (non-centerTab tab-to-tab skips; only the
centerTab thread -> tab-root shape triggers path 2). Strike the deep->deep
example; tighten the tab->tab example to name the centerTab shape. No code
change.

## Counter after R6: 0/5.

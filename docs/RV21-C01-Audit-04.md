# RV21-C01 Audit 04 (R4)

**Date:** 2026-07-26. **Round:** R4. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0;
full e2e 218/0 (after the R3 comment pass).

Both auditors BLOCKed with REAL §5 behaviour defects (not comments): the R1
morph-continuity fix made the RELEASE handoff continuous for the shapes the
reproduce specs covered, but it missed (a) the non-bidirectional NavPipelineHost
tab-to-tab shape (the offline LIST routes) and (b) the re-grab-mid-commit and
gesture-during-forward-enter handoffs (where a drag takes over a settle
mid-flight). Both are one-frame morph/icon/layer snaps.

## Findings

### F1 (R4-B, §5): morph snap on a non-bidirectional NavPipelineHost tab-to-tab back-swipe

The publication rule (`nav-pipeline-orchestrator.svelte.ts` `#republishToPager`,
`backMorphValue = ... || (fromIdx >= 0 && toIdx >= 0) ? null : rawDragFraction`)
nulls `backMorph` for ANY tab-to-tab on ANY host, but the settle arm's
`dragMorphWasStatic` (`#armSettleEaseFromGesture` ~L2638) only covers the
`bidirectional && outgoingHasTabs && incomingHasTabs` sub-case. The
non-bidirectional NavPipelineHost tab-to-tab case (the offline LIST mirror
routes `/offline`, `/offline/activity`, `/offline/bookmarks`, whose `leftHref`
pill-maps to the same tab) publishes `backMorph: null` during the drag (so the
drag morph stays at the static `currentHasTabs ? 1 : 0 = 1`) but the settle
captures `startMorph = dragMorphAtRaw(true, raw) = 1 - raw` (non-static), so the
morph snaps at release. Verified on `/offline -> /`: 119deg icon + 26.46px layer
snap. Same class as the R1 centerTab/targetIsSearch snaps; R1's sweep missed the
offline routes (migrated to the pipeline in DV20-C06).

### F2 (R4-A, §5): morph snap at the re-grab-mid-commit handoff (centerTab -> tab-root)

The drag morph formula `currentHasTabs ? 1 - bm : bm` is INVERTED for
`currentHasTabs === true` (gesture feedback toward back-arrow). The settle for
`centerTab -> tab-root` interpolates toward `destMorph = atRestMorph(true) = 1`.
They agree at the release instant but DIVERGE mid-commit (drag `1 - bm_now` ->
0; settle -> 1). When the user re-grabs mid-commit (`#beginGesture` cancels the
settle, seeds `bm = executor.state.progress` ~0.99 end-of-commit), the morph
derivation switches from settle to drag and snaps from ~1 to ~0. Verified:
180deg icon + 40px layer snap at the re-grab boundary. The existing
`re-grab mid-commit` test samples only the track m41, so it missed this.

### F3 (R4-A, §5 sibling): morph snap on gesture-during-forward-enter (centerTab)

`playEnterAnimation` arms a settle with `startMorph = destMorph = 1` for a
forward-enter to a centerTab route. A back-swipe started mid-enter cancels the
settle and seeds `bm = the enter's eased progress (> 0)`, so the drag branch
recomputes `morph = 1 - bm`, snapping from 1. Verified: 61deg icon snap. Sibling
of F2 (a drag taking over a settle whose morph is heading to 1 while
`currentHasTabs === true`).

### F4-F7 (R4-B, comments): stale comments exposed by F1

- `Header.svelte` drag-branch comment (~L184): "publishes backMorph for every
  claimed drag on a NavPipelineHost route" / "the only null publication is a
  tab-to-tab swipe on the bidirectional tab host" - false (offline tab-to-tab
  publishes null).
- `mobile-pager.svelte.ts` `backMorph` contract (~L14): same inaccuracy.
- `#armSettleEaseFromGesture` shape-analysis comment (~L2620): omits the
  non-bidirectional NavPipelineHost tab-to-tab static-morph shape.
- `resetPagerStore` deep-page branch comment (~L3263): "no pill highlight" /
  "Header in deep back-arrow mode" describes only the deep-page sub-case, not
  the offline LIST sub-case (pill highlighted, hamburger mode).

### Missing preventive tests

No e2e samples the vertical morph (`burgerRot` / `rootLayerTy`) across (a) an
`/offline -> /` back-swipe, (b) a re-grab-mid-commit, or (c) a
gesture-during-forward-enter. The track-only re-grab test let F1/F2/F3 ship.

## Fix for R5 (CMA)

1. **F1**: extend `dragMorphWasStatic` to drop the `bidirectional` qualifier
   (the publication rule's `(fromIdx >= 0 && toIdx >= 0)` clause covers any host;
   every tab-to-tab is a static-morph shape).
2. **F2 + F3**: make the morph continuous when a drag takes over a settle
   mid-flight (re-grab, gesture-during-forward-enter). The drag morph must seed
   from the settle's CURRENT morph value at the takeover instant (the §5
   "following-visual" principle: a re-grab tracks from the current visual, no
   jump), not recompute from `bm` with the inverted formula. This is the
   structural fix that closes the class for every drag-takes-over-settle
   boundary.
3. **F4-F7**: rewrite the four comments to the current publication/shape rules.
4. **Preventive tests**: add no-snap guards (`burgerRot` + `rootLayerTy`
   frame-to-frame continuity) for `/offline -> /`, re-grab-mid-commit
   (`/messages/<id>` -> inbox), and gesture-during-forward-enter.

## Out-of-scope (nitpicks)

- Journal `.md` prose; `.md`-only.
- The 6 pre-existing `e2e/tsconfig.json` errors (pre-date this cycle).

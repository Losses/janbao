# RV21-C01 Audit 148 (R148)

**Date:** 2026-08-07. **Round:** R148. **Votes:** auditor A PASS,
auditor B PASS. **Counter after: 2/5.**

## Outcome

**Second consecutive earned double-PASS** (R147 + R148). Both auditors did
exhaustive sweeps and found zero defects. The layer remains clean.

## A's clean PASS (174 tool uses)

A swept the full orchestrator (4911 lines), Header.svelte (919 lines),
mobile-pager, MobileTabBar, NavPipelineHost/TabHost, SearchScopePager,
header-probe, fab-scale, nav-resolvers, history-nav, and e2e specs. A
verified:

- **Count claims verified against code:** `#armSettleEase` 5 caller classes
  / 6 call sites; `#atRestMorph` 6 callers; `#dragMorphAtSettleTakeover`
  2 callers; `#searchAnchor` 5 reach paths; `#republishToPager` "five
  sub-cases" (3 tab-host + 2 deep-page).
- **Established-fact coverage verified:** every bidi-backward RAW
  parenthetical includes thread/compose (R145/R146 broadening intact);
  every null-condition comment uses "tab" (not "tab root") and cites
  `#gestureToTabIndex` for the non-bidi backward case (R143/R144 fixes
  intact).
- **`#dragMorphAnchor` clear sites:** unmount (1438), `#beginGesture`
  (1824), `#landAtRest` (2367), `#armSettleEase` (3324).
- **Sibling search:** grepped `backMorph`, `targetIsDeepPage`,
  `bidirectional`, `tab-to-tab`, `backward-to-*`, `isTabRootPath`,
  `#tabIndexFor`, `#gestureToTabIndex`, `backMorphIsNull` across the full
  layer. Every hit read. No defect found.
- **R137 F1 + R142 F2 correctness fixes sound.** One borderline note:
  `updateBackTarget` writes strict `#tabIndexFor(backTarget)` while mount
  writes loose `getCurrentTabIndex`; at runtime the strict value wins
  after the host's first reactive flush. Classified as consistent with
  the established facts (publication and settle-arm both read the same
  `#gestureToTabIndex`).

## B's clean PASS (139 tool uses)

B swept the same layer and verified:

- **Publication-rule consistency:** `#republishToPager`'s null condition
  matches both drag-to-settle capture sites. Gesture-release uses
  `#gestureToTabIndex` directly; discrete-nav reconstructs the drag's
  toIdx via `inputs.bidirectional !== true ? inputs.toTabIndex :
#tabIndexFor(...)`. Both equivalent to `#beginGesture:1974-1979`.
- **R137 F1 + R142 F2 correctness intact:** `dragMorphWasStatic =
targetIsSearch || (backMorphIsNull && !isCenterTabRoute)` correctly
  excludes centerTab routes (whose backMorph is RAW via the centerTab
  branch). The `!isCenterTabRoute` qualifier makes the helper robust.
- **Edge cases traced:** `/offline` -> `/` (null via both-pill-map);
  `/offline` -> `/profile` (RAW); `/offline/bookmarks` -> `/offline`
  (null via loose pill-map); centerTab routes (RAW via centerTab branch);
  bidi backward-to-deep/thread/compose/`/search` (RAW); bidi tab-to-tab
  (null via bidi clause). All consistent between publication and helpers.
- **Comment-accuracy:** all bidi-backward parentheticals include
  thread/compose; all null-condition citations reference
  `#gestureToTabIndex`; "tab" framing consistent. No past-state markers.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib` 552/0;
prettier clean; no U+2014 em-dash. No code change this round.

## Disposition

Counter after R148: **2/5**. The convergence is progressing steadily. Three
more consecutive double-PASSes needed (R149-R151) to close at 5/5.

**No git mutation.** No commits, no branches, no pushes.

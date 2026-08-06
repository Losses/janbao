# RV21-C01 Audit 147 (R147)

**Date:** 2026-08-07. **Round:** R147. **Votes:** auditor A PASS,
auditor B PASS. **Counter after: 1/5.**

## Outcome

**First earned double-PASS since R122-R123** (which R124 corrected). Both
auditors did exhaustive sweeps and found zero defects. The layer is clean.

## A's clean PASS (158 tool uses)

A swept the full orchestrator (4911 lines), Header.svelte (919 lines),
mobile-pager, MobileTabBar, NavPipelineHost/TabHost, SearchScopePager,
FloatingActionButtonLayer, header-probe, fab-scale, nav-resolvers,
history-nav, and the e2e specs. A verified:

- **R137 F1 + R142 F2 correctness fixes sound:** `#dragMorphAtSettleTakeover`'s
  `backMorphIsNull` parameter computed from `#gestureToTabIndex` at both call
  sites; the pill-mapped-but-not-tab-root snap is closed.
- **§5 intact:** 3 disjoint rAF channels, no CSS transitions, no animation-layer
  setTimeout.
- **Comment-accuracy sweep:** all R82-R146 fixes intact (startMorph
  characterization, drag-terminal vs interrupt-instant, bidi-backward
  parentheticals, terminal-value lexical sub-classes, compose centerTab
  mis-classification, thread-to-centerTab-route broadening, null-backMorph
  strict/loose framing, helper call-site enumerations, e2e universal-claim
  qualifiers).
- **Count claims verified:** `#armSettleEase` 5 caller classes / 6 call sites;
  `#atRestMorph` 6 callers; `#dragMorphAtSettleTakeover` 2 callers;
  `#searchAnchor` 5 reach paths.
- **No em-dashes, no past-state markers, no TODOs.**

One borderline observation (orchestrator:4601 "Offline LIST mirrors" label for
`/offline/bookmarks` which is `tag:'detail'`) -- classified as defensible
(behavior accurate, label semantic). NOT flagged.

## B's clean PASS (165 tool uses)

B swept the same layer and verified:

- **Bidi-backward parenthetical class fully closed:** all 6 sibling sites
  (orchestrator:2129, 4739, 4824, 4842-4844, mobile-pager:24, Header:209)
  now consistently list "(deep page, thread/compose, or `/search`)".
- **Null-backMorph comment class consistent:** all sites use "tab" (not
  "tab root") and reference `#gestureToTabIndex` (not `#tabIndexFor`) for
  the non-bidi backward case.
- **R142 F2 correctness fix re-traced:** publication and settle-arm agree
  for `/offline/bookmarks` -> `/offline` and `/` -> `/offline` shapes.
- **Fix A/B/C/D intact; §5 intact; no dead code; no past-state markers.**

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib` 552/0;
prettier clean; no U+2014 em-dash. No code change this round.

## Disposition

Counter after R147: **1/5**. The convergence has begun. Four more consecutive
double-PASSes needed (R148-R151) to close at 5/5.

**No git mutation.** No commits, no branches, no pushes.

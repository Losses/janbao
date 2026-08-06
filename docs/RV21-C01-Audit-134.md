# RV21-C01 Audit 134 (R134)

**Date:** 2026-08-05. **Round:** R134. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

Two confirmed defects, both genuine inaccuracies (not over-reaches).
Counter 0/5.

## A's finding -- `orchestrator:2847-2849` (case-1 reach-path example)

The settle-arm case-1 ("source and target tab-ness differ," the deep↔tab
shape) listed "a cross-tab bidirectional click" as an example. A
cross-tab bidirectional click is tab→tab on NavPipelineTabHost (both
endpoints `hasTabs === true`), which has SAME tab-ness, fails the case-1
condition, and is explicitly the arm-SKIP case 34 lines below (line 2883:
"a non-centerTab tab -> tab discrete nav on the bidirectional host ...
skips the arm"). So the example contradicted both case-1's "tab-ness
differ" requirement and the skip-case description. Fixed: dropped the
example (the other two -- "a tab-click exit" and "the back-button from a
deep page to its tab root" -- already cover deep↔tab).

## B's finding -- `orchestrator:4731-4735` (`#republishToPager` Deep-page mode sub-case)

The Deep-page mode docstring enumerated 2 sub-cases: "True deep page
(`fromTabIndex === -1`) -> raw" and "Offline LIST mirror whose target is
also pill-mapped (`fromIdx >= 0 && toIdx >= 0`) -> null." But the code's
`backMorphValue` in Deep-page mode is `(fromIdx >= 0 && toIdx >= 0) ? null
: rawDragFraction` -- which has a THIRD reachable combination: an offline
LIST source (`fromIdx >= 0`) bound for a non-pill-mapped target like
`/profile` (`toIdx < 0`) yields `rawDragFraction`, uncategorized by the
docstring (and reachable: `/profile` -> `/offline` then back-swipe returns
to `/profile`). A maintainer could misread "Offline LIST mirror -> null"
as covering all offline-LIST cases. Fixed: broadened sub-case 1 to
"Not both endpoints pill-map to a tab (a true deep page ... or an offline
LIST mirror whose target is a non-pill-mapped deep page like `/offline`
-> `/profile`) -> raw," so the two sub-cases partition exhaustively and
match the code.

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
comment-only changes.

## Disposition

Counter after R134: 0/5. Both findings were genuine (a self-contradiction
and a non-exhaustive enumeration), not the borderline over-reaches of
R130-R131. The pool continues to shrink (R132=1, R133=1, R134=2 confirmed).

**No git mutation.** No commits, no branches, no pushes.

# RV21-C01 Audit 102 (R102)

**Date:** 2026-08-03. **Round:** R102. **Votes:** auditor A BLOCK, auditor
B PASS. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): searchProgress dragSearchAnchor fallback visual defect + comment inaccuracy

**F1** `Header.svelte:613` -- the dragSearchAnchor fallback
`return dragSearchAnchor.search` returned 1 (the captured search-axis
value from a `/search` commit settle) during a tab-to-tab re-grab
(backMorph=null), making the search panel fully visible during a backward
tab-to-tab swipe where it should not appear.

**Comment inaccuracy (part a):** the comment claimed "only currently-
reachable shape (a non-search tab-to-tab settle)" and "no-op" -- wrong
since R91 added a 5th `#searchAnchor` seed site (`#armSettleEaseFromGesture`)
that can produce `{1, 1}` on a `/search` commit.

**Visual defect (part b):** for a forward-swipe-to-`/search` commit from
the last tab, re-grabbed during the awaitTitle window into a backward
tab-to-tab swipe, the fallback returned `dragSearchAnchor.search = 1`,
making `searchProgress = 1` and `trackStyle = translateX(-50%)` (search
panel fully slid in) during a tab-to-tab drag.

**Fix (code):** Changed the fallback from `return dragSearchAnchor.search`
to `return isSearch ? 1 : 0` (the at-rest searchProgress). When backMorph
is null (tab-to-tab, no search-axis motion), the search axis rests at 0.
For the non-search case (`anchor.search === 0`) this is a no-op; for the
`/search`-commit case it snaps the panel out (correct -- the user is
swiping away from search). Rewrote the comment to accurately describe
both cases.

## Auditor B: PASS

Exhaustive sampling (full orchestrator + Header + FAB + state machine +
resolvers + SearchScopePager + §5 sweep + all R91-R101 fixes verified).
Zero concerns.

## Orchestrator verification

Verified A's code path: the R91 re-seed at `#armSettleEaseFromGesture`
(`:3580-3584`) can produce `#searchAnchor = {1, 1}` on a `/search` commit
(capturedSearchProgress = 1, destSearch = 1). The re-grab captures
`#dragSearchAnchor = {search: 1, ...}`. When the new drag resolves to
tab-to-tab (`backMorph = null`), the inner guard fails and the fallback
fires. The fix returns the at-rest value (0) instead of the anchor (1).
`bun run check` 0/0; prettier + em-dash clean.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
A-F1 a code change (searchProgress fallback) + comment rewrite.

## Disposition

Counter after R102: 0/5. The second visual/code defect found in the
convergence loop (after R91's §5 search-axis snap). The searchProgress
dragSearchAnchor fallback held at the anchor value during a tab-to-tab
re-grab from a `/search` commit settle -- a consequence of R91 adding
the 5th seed site without updating the fallback's return value.

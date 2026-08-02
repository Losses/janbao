# RV21-C01 Audit 85 (R85)

**Date:** 2026-08-02. **Round:** R85. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Two defect classes this round, both real and both rooted in the
tap-scrub's actual scope.

## Auditor A (12 findings, CONFIRMED): "root<->search" narrows the tap-scrub scope

The tap-scrub arm (`notifyHeaderState:4233-4247`) fires on
`currentIsSearch !== prevIsSearch && pager.transitionTarget === null &&
!justLandedViaPipelineCommit` -- ANY isSearch flip. The in-source comment
(`:4190-4222`) explicitly documents "Covers root<->search ... deep<->
search (/profile <-> /search, /messages/<id> <-> /search, /search <->
/bookmarks, etc.)". 12 docstrings narrowed this to "root<->search",
omitting the reachable deep<->search shape. Broadened each:

- **F1** `BurgerArrowIcon:27` "during a root<->search tap-scrub" -> "during
  a tap-scrub" (the orchestrator's own R84-B-F1 rewrite residual).
- **F2** `Header:141` "the tap-scrub ease on a root<->search ENTER flip"
  -> "on an isSearch flip" (also drops the "ENTER" narrowing, the sibling
  R82-F5 missed).
- **F3** `orchestrator:576` "owns the root<->search horizontal-track
  scrub" -> "owns the isSearch-flip horizontal-track scrub".
- **F4** `orchestrator:608` "the root<->search tap-scrub arm" -> "the
  tap-scrub arm".
- **F5** `orchestrator:611` "a root<->search flip" -> "an isSearch flip".
- **F6** `orchestrator:3934` "a root<->search flip arms the tap-scrub" ->
  "an isSearch flip arms the tap-scrub" (the orchestrator's R82-F5
  residual -- dropped "ENTER" but left "root<->search").
- **F7** `orchestrator:3650` section header "Root<->search tap-scrub
  ease." -> "Tap-scrub ease (root<->search and deep<->search)."
- **F8** `Header:24` intro "the root<->search tap-scrub ease" -> "the
  root<->search / deep<->search tap-scrub ease".
- **F9** `Header:157` "The root<->search tap scrub does not touch morph"
  -> "The tap scrub does not touch morph" (the claim holds for all
  scrubs; the morph derivation structurally never reads tapMorph).
- **F10** `orchestrator:4270` "owns the root<->search horizontal-track
  scrub ... for the no-slide search-button case" -> "owns the isSearch-
  flip horizontal-track scrub" (the search button arms deep<->search from
  deep pages too).
- **F11** `orchestrator:584` `#scrubFromValue` "1 for an exit-from-root,
  0 for an enter-from-search" -> "1 when starting from a non-search page
  (root or deep), 0 when starting from /search" (`fromValue = prevIsSearch
? 0 : 1`).
- **F12** `orchestrator:587` `#scrubToValue` "0 for exit-to-search, 1 for
  enter-to-root" -> "0 when ending at /search, 1 when ending at a
  non-search page (root or deep)" (`toValue = currentIsSearch ? 0 : 1`).

A's sweep classified 6 "root<->search" sites as accurate (Fix-C-specific
last-tab-forward gesture at orchestrator:2007/2009/2135/4692/4762; and
the explicit "root<->search AND deep<->search" sites at Header:503,
orchestrator:4193/4210, mobile-pager:79). Left unchanged.

## Auditor B (1 finding, CONFIRMED): Header `iconProgress` omits the `currentHasTabs` branch

**F1** `Header.svelte:312-314` (the `iconProgress` docstring above the
derivation) said "Outside a scrub the morph reads `isSearch` ... or
`1 - morph`" -- omitting the `(searchScrubbing && currentHasTabs) => 0`
branch (the tab-root scrub-arm window before the first `setTapMorph`
tick). The actual fallback (`:320`) is
`isSearch || (searchScrubbing && currentHasTabs) ? 0 : 1 - morph`. This is
the sibling of R84-A's BurgerArrowIcon finding (R84-A's sweep was scoped
to the BurgerArrowIcon phrasing and missed this Header comment).
Broadened to capture all three cases.

## Orchestrator verification

Independently verified the core claim before fixing: read
`notifyHeaderState:4188-4248` -- the arm condition is
`currentIsSearch !== prevIsSearch && ...` (any isSearch flip), and the
in-source comment explicitly enumerates deep<->search cases. Confirmed
`fromValue = prevIsSearch ? 0 : 1` and `toValue = currentIsSearch ? 0 : 1`
(narrowing "root" to "non-search (root or deep)"). For B-F1, re-read the
`iconProgress` body (`:315-321`). A's sibling enumeration (18
"root<->search" hits, 6 accurate, 12 defective) trusted after
spot-checking the accurate classifications.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean; grep
confirms no "root<->search flip / tap-scrub arm / horizontal / ENTER /
exit-from-root / enter-to-root" scope-narrowing remains in the fixed
sites. Comment-only; runtime unchanged.

## Disposition

Counter after R85: 0/5. Two of A's sites (F1 BurgerArrowIcon, F6
orchestrator:3934) were residuals of the orchestrator's own prior
rewrites (R84-B-F1 and R82-F5) -- the same "shorthand narrows scope"
pattern as the [[docstring-rewrite-must-cover-all-branches]] lesson.

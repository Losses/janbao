# RV21-C01 Audit 87 (R87)

**Date:** 2026-08-02. **Round:** R87. **Votes:** auditor A BLOCK, auditor
B PASS. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): `searchScrubbing` getter "freeze" narrows to the tab case

**F1** (2 sibling sites, same class):

- `nav-state-machine.svelte.ts:145-147` -- "`searchScrubbing` ... Read by
  the Header's `iconProgress` derivation to freeze the hamburger icon on a
  tab-root page while the search-layout scrub runs."
- `orchestrator:938-940` -- "The Header reads this to freeze the hamburger
  icon during a tap scrub."

Both narrow the consumer role to "freeze", but on a **deep<->search**
scrub the icon EASES (back-arrow into hamburger): `scrubIconEndpoint = 1`
-> `iconProgress = tapMorph * 1`, easing 1->0 across the scrub. Only a
**tab<->search** scrub freezes it (`scrubIconEndpoint = 0`). The accurate
sibling descriptions exist at `Header.svelte:304-316`, `BurgerArrowIcon:26-30`,
`mobile-pager:78-87`, and the orchestrator's own `#armTapScrubEase`
(`:3663-3671`). R84-A (BurgerArrowIcon) and R85-B (Header) sweeps missed
these two getter docstrings. Rewrote both to "holds the hamburger on a
tab-root page (scrubIconEndpoint = 0) and eases the back-arrow into the
hamburger on a deep page (scrubIconEndpoint = 1)".

## Auditor B: PASS

Exhaustive sampling (full orchestrator, Header, BurgerArrowIcon,
MobileTabBar, SearchTabBar, header-probe, fab-scale, nav-resolvers,
mobile-pager, nav-state-machine, nav-executor, nav-executor-logic,
NavPipelineHost, FloatingActionButtonLayer; the reproduce specs); verified
the R86 fixes accurate; all sibling greps for the R85/R86 classes returned
no residuals; gates green. Did not flag the `searchScrubbing` getter sites
(A's sampling of the consumer-role description reached them).

## Orchestrator verification

Independently verified both sites before editing: confirmed the
`iconProgress` body (`tapMorph * scrubIconEndpoint`, with
`scrubIconEndpoint` = 0 for tab-root, 1 for deep) and that "freeze"
describes only the tab case. Sibling sweep: the two getter docstrings are
the only "freeze the hamburger" sites in the layer.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R87: 0/5 (auditor A's BLOCK resets; auditor B's PASS does
not count when the other auditor BLOCKs). The layer is nearly clean --
one residual class, two sites; B PASSed.

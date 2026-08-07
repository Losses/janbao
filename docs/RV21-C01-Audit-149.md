# RV21-C01 Audit 149 (R149)

**Date:** 2026-08-07. **Round:** R149. **Votes:** auditor A BLOCK (1),
auditor B BLOCK (7). **Counter after: 0/5.**

## Outcome

New lexical neighborhood: tap-scrub icon-value docstrings use "tab root"
(strict) where the criterion is loose pill-map (`getCurrentTabIndex >= 0`).
B found 7 publisher/state-machine/store sites; A found 1 consumer-side
Header sibling (sibling-sweep miss). All 8 fixed.

## B's findings (7 sites, all fixed)

`scrubIconEndpoint = 0` / `#scrubTargetTabs = true` criterion is loose pill-map
(`nonSearchHasTabs = currentHasTabs`, which is `getCurrentTabIndex >= 0`), not
strict tab root. Thread/compose/offline LIST routes pill-map but are not tab roots,
so "tab root" framing excludes reachable cases where the value is 0.

- `orchestrator:600` (#scrubTargetTabs field docstring)
- `orchestrator:946` (searchScrubbing getter docstring)
- `orchestrator:3716` (#armTapScrubEase nonSearchIconValue)
- `orchestrator:4272` (notifyHeaderState inline)
- `mobile-pager:82` (scrubIconEndpoint PagerUpdate field)
- `nav-state-machine:147` (searchScrubbing getter)
- `Header:308` (iconProgress derivation) -- A's sibling-sweep miss

All fixed: "tab root" -> "route with tabs" / "has tabs".

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib` 552/0;
prettier clean; no U+2014 em-dash. Comment-only changes.

## Disposition

Counter after R149: 0/5 (reset from R147-R148's 2/5). New lexical
neighborhood (tap-scrub icon-value) not covered by R137-R148's sweeps.

**No git mutation.** No commits, no branches, no pushes.

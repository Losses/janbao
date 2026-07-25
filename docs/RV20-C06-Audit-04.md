# DV20 Cycle 6 - Audit 04 (R04)

**Date:** 2026-07-24. **Round:** R04. **Counter after:** 0/5 (auditor A PASS;
auditor B BLOCK). **Gate:** pending (behavioral fix; e2e running).

Auditor A voted PASS. Auditor B voted BLOCK on a behavioral defect (not a comment):
the Header morph discontinuity on back-swipe from the three offline LIST routes.

## B finding (1, fixed)

- **nav-pipeline-orchestrator.svelte.ts:3158 (concern).** The `#republishToPager`
  method published `backMorph: rawDragFraction` for non-bidirectional hosts (the
  offline LIST routes `/offline`, `/offline/activity`, `/offline/bookmarks` on
  `NavPipelineHost` without `centerTab`). These routes pill-map to a tab index via
  `TAB_BAR_CONFIG` (`getCurrentTabIndex('/offline') = 0`), so `currentHasTabs ===
true` in the Header. The morph formula `currentHasTabs ? 1 - bm : bm` drove morph
  from 1 toward 0 during the drag (wrong direction for a tab-to-tab transition). At
  release the settle latched both endpoints with `hasTabs === true`, so morph = 1
  (constant), producing a visible SNAP from `(1 - bm_release)` back to 1 across all
  three Header chrome layers.

  This is the ONLY route class in the app where `currentHasTabs === true` AND the
  host is non-bidirectional AND `centerTab` is unset (all other pill-mapped routes
  use `centerTab`, which forces `backMorph: null` via the early return).

  **Fix:** Extended the `backMorphValue` condition from
  `bidirectional && !targetIsDeepPage` to
  `(bidirectional && !targetIsDeepPage) || (fromIdx >= 0 && toIdx >= 0)`. When
  both source and target pill-map to a tab index (tab-to-tab on any host type),
  `backMorph` is `null` (morph stays static at 1, the Header stays in hamburger
  mode throughout, no discontinuity). This matches the behavior of bidirectional
  hosts and `centerTab` routes for the same transition type.

## A note (PASS)

A confirmed both specs (C05b2 + C06) are satisfied: all 8 C06 end-state items
verified, all C05b2 items held, the R01-R03 fixes held, every comment accurate.

## Gate

check 0 errors / 0 warnings (1469 files); lint exit 0; prettier clean; no U+2014.
Behavioral fix (orchestrator `#republishToPager` logic); full e2e running to
confirm zero regressions. Counter 0/5 (B's concern). R05 audits the fixed pipeline.

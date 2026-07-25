# Cleanup Audit 06 (R06)

**Date:** 2026-07-25. **Round:** R06. **Counter after:** 0/5 (auditor A PASS;
auditor B BLOCK). **Gate:** green (comment-only fixes; e2e stands).

Auditor A voted PASS (the swipe.ts `createSwipeRuntime` extraction and the DCL
`sidebarTop` snippet are byte-equivalent behavior-preserving; all R01/R03 fixes
held). Auditor B voted BLOCK on four pre-existing stale e2e comments (2 classes)
that reference removed mechanisms.

## B findings (4, 2 classes, fixed)

### Class 1 - stale "swipe activated!" console-log gating (1 site)
- **e2e/backtarget.spec.ts:13-19 (very low).** The file docstring claimed each test
  is gated on the `[detectSwipe] swipe activated!` console log. That log was removed
  in a prior log-removal pass; the test actually gates on URL change. Fixed: removed
  the stale gating claim.

### Class 2 - stale "navigates on transitionend" mechanism (3 sites)
- **e2e/tab-exit-preview.spec.ts:20 (very low).** Claimed navigation happens "on
  transitionend." Navigation is rAF-driven (orchestrator commit-settle). Fixed: "on
  the orchestrator's commit-settle."
- **e2e/helpers.ts:419-422 (very low).** Same stale claim. Fixed identically.
- **e2e/swipe-back-pill-flicker.spec.ts:130 (very low).** Claimed "the transitionend
  reset." The reset is the orchestrator's at-rest publication. Fixed: "the
  orchestrator's at-rest reset."

## Gate

check 0 errors / 0 warnings (1469 files); lint exit 0; prettier clean; no U+2014.
Comment-only fixes; e2e 210 / 0 flaky stands. Counter 0/5. R07 audits the fixed
pipeline.

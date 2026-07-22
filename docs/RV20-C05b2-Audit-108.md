# DV20 Cycle 5b2 - Audit 108 (R108)

**Date:** 2026-07-22. **Round:** R108, the sixth spec-scoped round. **Counter after:** 0/5 (auditor A BLOCK; auditor B PASS on the fixed state). **Gate:** green (comment-only fixes).

Auditor A voted BLOCK on 2 concerns. Auditor B voted PASS (B read the file after the fixes were applied and confirmed all comments accurate).

## Findings and fixes

- **A1 (MobileTabBar.svelte:11-15, concern).** "the orchestrator publishes ... each frame on its single rAF" and "the rAF's per-frame publication drives...": overclaimed rAF ownership during a live drag (synchronous per pointermove, not rAF; and "single rAF" is wrong, the orchestrator has 3 rAF channels). Fixed: attributed to the orchestrator's publication (synchronous per pointermove during a drag, via the rAF channels during a commit/settle/scrub).
- **A2 (BurgerArrowIcon.svelte:22-30, concern).** "The orchestrator's single rAF owns every motion of the morph": same rAF-ownership overclaim. Fixed: "The orchestrator owns the morph's motion through its publication (synchronous during a drag, via the rAF channels during a commit/settle/scrub)."

These are the last 2 siblings of the rAF-ownership-overclaim class (R106 fixed 7 + R107 fixed 2 = 9; R108 fixed the remaining 2; total 11 sites across the pipeline). The class is now closed.

check + lint green.

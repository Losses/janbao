# DV20 Cycle 5b2 - Audit 116 (R116)

**Date:** 2026-07-22. **Round:** R116, the fourteenth spec-scoped round. **Counter after:** 0/5 (auditor A BLOCK; auditor B PASS on the fixed state). **Gate:** green (comment-only fixes).

Auditor A voted BLOCK on 2 concerns. Auditor B voted PASS (read the file after the fixes were applied; found all comments accurate).

## A findings (2, fixed)

- **A1 (mobile-pager.svelte.ts:24-27, concern).** The "Header morph signals" parenthetical included `fractionalIndex`, `active`, `targetIndex`, which the Header does not read (they are MobileTabBar / SearchTabBar signals). A sibling of the R104-fixed `replaceStateIntent` removal from the same list (R104 removed one; these three were missed). Fixed: removed the three non-Header fields from the list (remaining: `tapMorph`, `backMorph`, `transitionTarget`, `scrubIconEndpoint`, `dragging`).
- **A2 (Header.svelte:32, concern).** "§5: one rAF (the orchestrator's) owns every motion" overclaim: during a drag no rAF runs (synchronous per pointermove); outside drags there are three rAF channels (not one). A sibling of the R108 "single rAF" and R113 "gesture rAF" classes, missed because those greps did not target the "one rAF" phrasing. Fixed: "§5: the orchestrator's publication (synchronous per pointermove during a drag, via the rAF channels during a commit/settle/scrub) drives every motion."

check + lint green.

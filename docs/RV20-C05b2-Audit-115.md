# DV20 Cycle 5b2 - Audit 115 (R115)

**Date:** 2026-07-22. **Round:** R115, the thirteenth spec-scoped round. **Counter after:** 0/5 (both auditors BLOCK). **Gate:** green (comment-only fixes).

Both auditors voted BLOCK on 7 combined comment-accuracy concerns. A: 1 (MobileTabBar parenthetical overstates which rAF channels publish its fields). B: 6 (rAF-ownership overclaim siblings in SearchScopePager, SearchTabBar, Header). All fixed.

## A finding (1, fixed)

- **A1 (MobileTabBar.svelte:13, concern).** "via the rAF channels during a commit/settle/scrub" overstated: MobileTabBar reads only `fractionalIndex` / `targetIndex` / `backMorph`, published only by the executor's commit rAF (the settle rAF writes to the state machine; the tap-scrub rAF writes to `tapMorph`; neither publishes to MobileTabBar's pager fields). Fixed: "via the executor's commit rAF during a commit slide."

## B findings (6, fixed)

- **B1-B3 (SearchScopePager.svelte:13, 76-79, 281-282).** "The rAF owns every frame" overclaim: during a drag `swipeMove` writes `visualIndex` directly (the rAF is cancelled). Fixed each to distinguish the drag phase (pointermove-driven) from the settle phase (rAF-driven).
- **B4 (SearchTabBar.svelte:17-23).** "the SearchScopePager rAF's per-frame publication owns every motion" overclaim. Fixed: attributes to per-pointermove during a drag and the settle rAF on release.
- **B5 (Header.svelte:347-350).** "the gesture rAF runs" overclaim. Fixed: "the orchestrator's publication runs."
- **B6 (Header.svelte:620-623).** "the orchestrator's rAF publication drives `searchProgress` each frame" overclaim. Fixed: "the orchestrator's publication, synchronous per pointermove during a drag and via the rAF channels during a commit/settle/scrub, drives `searchProgress`."

The rAF-ownership-overclaim class累计修了约 20 处（R106-R115）。check + lint green.

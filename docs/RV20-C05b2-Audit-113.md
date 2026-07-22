# DV20 Cycle 5b2 - Audit 113 (R113)

**Date:** 2026-07-22. **Round:** R113, the eleventh spec-scoped round. **Counter after:** 0/5 (both auditors BLOCK). **Gate:** green (comment-only fixes).

Both auditors voted BLOCK on 2 combined comment-accuracy concerns, all fixed.

## A finding (1, fixed)

- **A1 (Header.svelte:371-374, concern).** The trackStyle comment said "the orchestrator's rAF (gesture rAF or tap-scrub rAF) drives every frame." rAF-ownership overclaim: during a live drag the executor's rAF is stopped and the orchestrator publishes synchronously per pointermove. This is a sibling of the R106-R108 class that was missed because the grep targeted "executor's rAF" / "single rAF" but not the "gesture rAF" phrasing. Fixed: "the orchestrator's publication (synchronous per pointermove during a drag, via the rAF channels during a commit/settle/scrub) drives every frame."

## B finding (1, fixed)

- **B1 (FloatingActionButton.svelte:12-16, concern).** The atom docstring overclaimed "Every motion that affects the transform (route-transition scale, scroll-hide translateY) is driven by the global nav-pipeline orchestrator's per-frame publication." The scroll-hide translateY is driven by the scroll-chrome store (its own rAF-throttled scroll listener), not the orchestrator. Fixed: split the attribution: scale from the orchestrator; translateY from the scroll-chrome store.

check + lint green.

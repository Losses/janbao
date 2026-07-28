# RV21-C01 Audit 14 (R14)

**Date:** 2026-07-28. **Round:** R14. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0.

Both auditors BLOCKed on the SAME finding (converging): the FAB capture at the
discrete-nav arm reads post-reset values. The morph capture at the same boundary
is correctly pre-reset (R5); the FAB capture is asymmetric.

## F1 (§5, primary, probe-verified by both auditors): FAB scale snaps at the drag-to-discrete-nav handoff

The discrete-nav arm in `onSvelteKitBeforeNavigate`
(`nav-pipeline-orchestrator.svelte.ts`):

- L2536 captures `liveDragMorph` reading `this.#publication.progress` BEFORE
  the reset (L2555 `this.#progress = 0`) and BEFORE the state-machine dispatch
  (L2546-2554). Correct (morph capture is live on the OLD plan).
- L2719 captures `capturedFabScale = this.#fabScaleAtSettleInstant()` AFTER the
  reset AND after the dispatch. So `#fabScaleAtSettleInstant` reads
  `progress = 0` with the NEW plan's from/to, not the drag's live raw on the
  OLD plan. The captured value disagrees with the FAB layer's last drag-frame
  value -> one-frame FAB snap (~0.34, probe-verified by both auditors on
  `/messages/<id>` back-swipe interrupted by `__e2eGoto('/')`).

**Fix (both auditors specify it):** co-locate the FAB capture with
`liveDragMorph` at L2536 (before the dispatch/reset), capturing the value into
a local and consuming it inside the conditional arm at L2719.

Sibling sweep: only the discrete-nav arm has the post-reset capture pattern;
the other 5 `#fabScaleAtSettleInstant()` call sites read publication live.

## F2 (comments): the FAB capture comments overclaim

L2703-2718 + the `#fabScaleAtSettleInstant` docstring claim the capture reads
the in-flight value. Wrong: it reads post-reset. Rewrite after the fix.

## F3 (gate broken, FIXED): leftover probe specs

Three probe specs left by prior auditors (one with a broken import) broke
`bun run test:e2e`. **Fixed: all deleted.**

## Counter after R14: 0/5.

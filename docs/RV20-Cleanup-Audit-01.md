# Cleanup Audit 01 (R01)

**Date:** 2026-07-25. **Round:** R01. **Counter after:** 0/5 (auditor A PASS;
auditor B BLOCK). **Gate:** green (comment-only fix; e2e stands).

Auditor A voted PASS (verified the `createSwipeRuntime` extraction is byte
-equivalent behavior-preserving; the `sidebarTop` snippet is a correct Svelte 5
extraction; the `user` prop docstring fix is accurate). Auditor B voted BLOCK on
one JSDoc mis-attribution.

## B finding (1, fixed)

- **swipe.ts:253 (very low).** The `createSwipeRuntime` JSDoc said "the runtime
  requests it" (referring to `setPointerCapture`), but the runtime never calls
  `setPointerCapture`; the calls live in each action's own `onDown` / `onMove`
  handler. Fixed: "each action requests it in its own `onDown` / `onMove` handler."

## Gate

check 0 errors / 0 warnings (1469 files); lint exit 0; prettier clean; no U+2014.
Comment-only fix; e2e 210 / 0 flaky stands. Counter 0/5. R02 audits the fixed
pipeline.

# DV20 Cycle 6 - Audit 02 (R02)

**Date:** 2026-07-24. **Round:** R02. **Counter after:** 0/5 (auditor A BLOCK;
auditor B PASS). **Gate:** green (comment-only fix; e2e stands).

Auditor A voted BLOCK on three stale orchestrator comments that cited
`/offline/bookmarks` as a non-pipeline example; auditor B voted PASS.

## A findings (3 siblings, fixed)

- **nav-pipeline-orchestrator.svelte.ts:632, 1941, 1988 (concern).** Three comments
  used `/profile -> /offline/bookmarks` as the concrete example of a non-pipeline
  destination. After C06, `/offline/bookmarks` is in `isNavPipelineRoute` (gate line
  78), so that nav is now deep-to-deep (intercepted), not non-pipeline. Fixed:
  replaced `/offline/bookmarks` with `/drafts` (genuinely non-pipeline; not in
  `isNavPipelineRoute`) in all three comments.

## B note (PASS)

B confirmed the C06 implementation is sound (all 8 end-state items verified; the
offline-page-cache-source, the gate extension, the NavPipelineHost mounting, the
resolver pairs, the FAB exclusion, the DeepPreviewSkeleton fallback). B noted an
out-of-scope stale comment in `idb.ts:14-17` (data-layer file, not navigation).

## Gate

check 0 errors / 0 warnings (1469 files); lint exit 0; prettier clean; no U+2014.
Comment-only fix; e2e 210 / 0 flaky stands. Counter 0/5. R03 audits the fixed
pipeline.

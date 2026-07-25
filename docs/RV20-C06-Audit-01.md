# DV20 Cycle 6 - Audit 01 (R01)

**Date:** 2026-07-24. **Round:** R01, the first C06 audit round. **Counter after:**
0/5 (both auditors BLOCK). **Gate:** green (comment-only fixes; e2e stands).

Both auditors voted BLOCK on stale comments introduced by the C06 implementation
(the CMA changed the code but did not update pre-existing comments that described
the pre-C06 state).

## A finding (1, fixed)

- **route-config.test.ts:45-46 (low).** The test comment said offline routes "mount
  DualColumnLayout only." After C06 they mount `NavPipelineHost` inside
  `DualColumnLayout`. Fixed: "NavPipelineHost inside DualColumnLayout; they do not
  participate in the FAB layer."

## B finding (1, fixed)

- **page-cache.svelte.ts:30-34 + 132 (low).** The file header and the `ensure`
  method docstring said "No current caller uses `ensure`... the default source set
  is empty... `ensure` is equivalent to `get`." After C06 the offline LIST routes
  use `ensure` and an IDB-backed source is registered. Fixed: both now describe the
  offline LIST routes using `ensure` to read IDB data through the cache, with the
  IDB source registered eagerly at module load.

## Gate

check 0 errors / 0 warnings (1469 files); lint exit 0; prettier clean; no U+2014.
Comment-only fixes; e2e 210 / 0 flaky stands. Counter 0/5. R02 audits the fixed
pipeline.

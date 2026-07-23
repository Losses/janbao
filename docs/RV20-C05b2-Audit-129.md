# DV20 Cycle 5b2 - Audit 129 (R129)

**Date:** 2026-07-23. **Round:** R129, the twenty-seventh spec-scoped round.
**Counter after:** 0/5 (both auditors BLOCK). **Gate:** green (comment + dead-code

- flaky-root-cause fixes; full e2e re-run, zero flakies).

Both auditors voted BLOCK, on two different classes. Auditor A found four
production-docstring siblings (compose routes omitted from parenthetical route
partitions in nav-pipeline-orchestrator.svelte.ts). Auditor B found eight
e2e/helpers stale references to removed mechanisms (LoadingChip cross-tab overlay,
chip-mode, leftNeedsLoading, follow()), including dead fields in e2e/helpers.ts.
A fixer sub-agent fixed the twelve cited plus two horizontal siblings (14 total).
The fixer's full-e2e run surfaced one flaky (fab.spec.ts:791, FAB pointer-events
when scroll-hidden) which the fixer flagged as out-of-scope; the orchestrator
root-caused it (a load-induced timing race: a fixed 160ms wait insufficient under
concurrent CI load) and fixed it with a deterministic poll, since a flaky is a
defect, never an accepted exception.

## Findings fixed (15 total)

### Class 1 - compose routes omitted from parenthetical route partitions (production docstrings, 6 sites)

`nav-pipeline-orchestrator.svelte.ts`: L35-38 (header), L249 (centerTab field),
L251-257 (bidirectional field), L947-948 (playEnterAnimation), L1192
(#interpretIntent), L3137-3139 (#republishToPager branch). Each listed
NavPipelineHost / non-bidirectional / deep-mode routes as "thread and deep-page"
without compose; fixed to include compose (compose routes mount NavPipelineHost
via MessageCompose and are non-bidirectional).

### Class 2 - stale e2e references to removed mechanisms (7 sites)

- `e2e/reproduce-user-bugs.spec.ts:570-580`: "LoadingChip overlay" comments
  rewritten to the DeepPreviewSkeleton fallback; the orphan assertion fragment
  restored as a proper regression-guard `expect()`.
- `e2e/reproduce-new-mobile-bugs.spec.ts:194-201`: test name/description rewritten
  from the removed chip-fallback to "chip overlay stays absent on a compose
  back-target (End state #4)".
- `e2e/fab-compose-backswipe.spec.ts:17-26`: file docstring rewritten (no
  `.loading-overlay`).
- `e2e/swipe-forward-back-deep-page.spec.ts:541-542`: `leftNeedsLoading` comment
  rewritten.
- `e2e/fab-boundary-swipe-sync.spec.ts:13-18, 61-64`: `follow()` / back-chip
  comments rewritten to the actual boundary rubber-band mechanism (in
  `#interpretIntent`).

### Class 3 - e2e/helpers.ts dead code + stale docstring

- `e2e/helpers.ts:787-796`: `captureGplBackSwipe` docstring rewritten (no
  chip-mode / tanh / loading-overlay); `chipMode` / `chipText` documented as
  End-state-#4 regression guards.
- `e2e/helpers.ts:798-803, 826-838`: removed the truly-dead `overlayWidth` and
  `overlayBg` fields plus their capture lines (verified unread by any test); kept
  `chipMode` / `chipText` (regression guard) and `previewPanel` / `trackM41`
  (geometry).

### Class 4 - flaky root cause (fab.spec.ts:791)

The fixer's full-e2e run had 209 passed / 1 flaky (fab.spec.ts:791 "FAB
non-interactive when scroll-hidden", failed attempt 1, passed retry). The fixer
flagged it out-of-scope; the orchestrator did not accept that. Isolation: 10/10
pass; the flake is load-induced (a fixed 160ms wait insufficient under concurrent
CI load for the rAF-throttled scroll-chrome listener plus the reactive binding to
propagate scroll-hide to pointer-events). Fixed by replacing the fixed wait with a
deterministic poll (2s deadline) for `pointer-events === 'none'`; the assertion is
unchanged (no bar lowered). Post-fix: full e2e 210 passed / 0 flaky.

## Gate

check 0 errors / 0 warnings (1467 files); lint exit 0 (similarity informational;
type duplicates 0); prettier clean; no U+2014; FULL e2e 210 passed / 0 flaky
(9.1m, exit 0). This round's fix touched e2e infrastructure (helpers.ts + spec
files) and a test's timing, so the full e2e was re-run and is zero-flaky. Counter
0/5 (both auditors BLOCK). R130 audits the fixed pipeline under the spec scope.

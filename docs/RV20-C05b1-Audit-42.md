# RV20-C05b1 - Audit Round 42 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A FAIL (2), B FAIL (2). Core logic verified sound.

## Fixes landed (all 4 concerns resolved)

- **B-C1 (centre panel off-screen during chip-exit)**: `panelCount` is
  now `$derived(chipExit ? 1 : 2)` - the track shrinks to 100% on chip-
  exit so the centre fills the viewport at translateX(0). The plan's
  `restingTranslate` is overridden to 0 for chip-exit (via a new
  `restingTranslateOverride` parameter on `#resolvePlan`). The SSR
  `initialTrackTransform` drops to `''` on chip-exit (no translateX
  needed). The `{#if isMobile && !chipExit}` left-section guard stays
  (the left section is not needed when panelCount=1; the chip overlay
  stands in for the source list).
- **A-C1 (updateViewport guard misses #isEnterAnimation)**: added
  `|| this.#isEnterAnimation` to the guard.
- **A-C2 (#chipExitPhase docstring)**: rewrote to accurately describe
  the two paths to 'sliding'.
- **B-C2 (no movement during chip-exit preload)**: MISVERIFIED in R42
  (claimed "GPL also freezes during preload, executor.stop() matches GPL,
  NOT a gap"). That cited GPL's gesture-commit path (`:681`), not the
  tab-click preload path (`:803`). R43 read GPL directly: GPL's tab-click
  chip-exit jumps to `+maxDrag` during preload (`GesturePageLayout.svelte
:477-478`), then `+W` - it does NOT freeze. This IS a divergence,
  tracked as R43 C1 (the chip-exit family). See
  `docs/RV20-C05b1-Audit-43.md`.
- **updateViewport stale after one-shot resize**: the at-rest `$effect`
  now re-calls `updateViewport` with the current viewport width when
  the publication lands (plan goes null), so a deferred resize from an
  in-flight transition is applied before the next gesture starts.
- **TAB_CLICK_COMMIT_MS docstring**: now mentions playEnterAnimation.

## Gate outputs (real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec mobile + desktop sweep    80 passed
```

Consecutive pass votes: **0** (R42 carried concerns; R43 audits post-fix).

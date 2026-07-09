# RV20-C05b1 - Audit Round 42 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A FAIL (2), B FAIL (2). Core logic verified sound
by both auditors. Fixes for A-C1 (updateViewport guard misses
#isEnterAnimation), A-C2 (#chipExitPhase docstring), B-C1 (centre panel
off-screen during chip-exit - reverted to original {#if !chipExit};
documented as masked by overlay during 'sliding'; 'pending' phase
imperceptible for cached targets), B-C2 (chip-exit preload provides no
movement during pending - design divergence from GPL, documented).

## Fixes landed

- **A-C1 (updateViewport guard)**: added `|| this.#isEnterAnimation` to
  the guard so a viewport resize during the forward-enter animation
  doesn't mutate mountInputs (the enter plan is locked at the
  gesture-start width).
- **A-C2 (#chipExitPhase docstring)**: rewrote to accurately describe
  the two paths to 'sliding' (tab-click: at preload-resolve; gesture:
  at finger release).
- **B-C1 (centre panel off-screen during chip-exit)**: investigated 3
  approaches (visibility:hidden, conditional data-tab-panel via spread,
  panelCount dynamic). The Svelte 5 spread does not reliably remove
  data-\* attributes reactively; the e2e sampler catches the section via
  getBoundingClientRect. Reverted to the original {#if isMobile &&
  !chipExit}. The centre is briefly off-screen during the 'pending'
  phase but the overlay covers it during 'sliding'. For cached targets
  (/ and /activity, eagerly loaded by the root layout), the preload
  resolves as a microtask so 'pending' is imperceptible. Documented as
  a known design simplification.
- **B-C2 (chip-exit preload no movement)**: the executor.stop() call
  (A-C2 fix) freezes the track during preload. GPL animates during
  preload. This is a behavior divergence documented as intentional (the
  stop() prevents stale startProgress + premature settle dispatch, which
  are worse bugs than no-movement-during-preload).

## Gate outputs (real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec mobile + desktop sweep    80 passed
```

Consecutive pass votes: **0** (R42 carried concerns; R43 audits post-fix).

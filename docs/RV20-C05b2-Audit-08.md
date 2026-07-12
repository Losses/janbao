# RV20-C05b2 - Audit Round 8 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (1 MED + 2 LOW); B PASS-WITH-CONCERNS (3
CONCERN).** Counter stays 0/5.

Both verified the core pipeline sound + every trajectory clean (gesture, tab-click,
cross-tab, deep-link, forward enter, tab-to-tab adjacent + non-adjacent, boundary,
mid-commit re-grab both directions, mobile->desktop breakpoint mid-commit,
reduced-motion). All Known conditions #1-11 assessed as known + planned. The
findings are one §13.5 architecture concern + comment/doc inaccuracies.

## Fixed

- **A #1 (MED) - state-machine plan `progressDirection` diverged from the
  executor's on cancel (§13.5).** Real: `executor.onCancel` flips its plan copy
  to `progressDirection=1` (so the commit integrator targets FROM), but the
  reducer's `cancel` case preserved the resolved plan (`progressDirection=0`),
  so `publication.plan.progressDirection` carried the commit direction through
  the cancel animation. Benign today (no consumer reads it during a cancel) but a
  §13.5 divergence. FIX: the reducer's `cancel` now produces
  `{ ...plan, progressDirection: 1 }`, matching the executor. Added a test
  assertion (`s3.macro.plan?.progressDirection === 1`).
- **A #2 (LOW) - `/messages/add/[userId]` missing from the spec's compose-scope
  list.** Doc gap (the gate + test already cover it). FIX: added it to the spec's
  compose-routes line; also fixed the stale "served by MobileTabPager" on the tab
  roots line -> `NavPipelineTabHost`.
- **A #3 (LOW) - `recoverDesktopFlipNav` comments referenced GPL's `pendingNav`
  wall-clock cap unqualified.** FIX: rewrote to a direct description (the
  mobile->desktop analogue of commit-settle) with no dead-mechanism reference.
- **B C1/C2/C3 (CONCERN) - stale "Family A sampler" / "-33%" references.**
  `gesture-constants.ts` (BOUNDARY_RUBBER_BAND_FACTOR comment), `e2e/tab-host-swipe.spec.ts`
  (header + assertion message), `e2e/enter-animation.spec.ts` (-33% -> -50%: the
  2-panel host rests at -50%, not the old 3-panel -33%). All rewritten.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab tab-host-swipe tab-swipe-preview-height    94 passed (3.7m)
```

Consecutive pass votes: **0/5** (A PWC + B PWC; the §13.5 cancel-direction fix +
the comment/doc inaccuracies fixed). R9 audits the post-fix state.

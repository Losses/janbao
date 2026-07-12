# RV20-C05b2 - Audit Round 6 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (1 MED + 2 LOW + 1 CONCERN); B PASS-WITH-CONCERNS
(7 CONCERN + 1 LOW).** Counter stays 0/5.

Both verified the core pipeline sound (state machine authoritative; no
CSS-transition/setTimeout/getComputedStyle in the gesture layer; sampler gone;
geometry, re-grab continuity, boundary, reduced-motion all hold;
MobileTabPager/GesturePageLayout mounted on no route). Findings triaged for
validity; B LOW-1 (FAB forward-enter timing) was investigated to root cause +
fixed rather than dismissed as "probably invisible."

## Real defects fixed

- **A #1 (MED) - NavPipelineTabHost loses a mid-commit nav on a mobile->desktop
  breakpoint cross.** Real: NavPipelineHost's mq handler calls
  `recoverDesktopFlipNav()` to land an in-flight commit before teardown, but the
  tab host (torn down by the `(tabs)` layout's mq handler) had no equivalent.
  FIX: the `(tabs)` layout's mq `sync` now calls
  `getNavPipelineOrchestrator()?.recoverDesktopFlipNav()` on a mobile->desktop
  flip before NavPipelineTabHost destructs (mirroring NavPipelineHost).
- **A #2 (LOW) - boundary release jumped on negative executor progress.** Real
  (the mirror of R4 A #1, residual): the boundary release gate
  `executor.state.progress > 0` was false for a negative progress (a
  direction-reversing re-grab), so `#landAtRest` cleared state with no animation
  and the at-rest `$effect` jumped the track (§5 "No jump"). FIX: the gate is
  `!== 0` (any non-zero progress cancels-animate back; 0 lands at rest).
- **B LOW-1 - FAB family-swap ease exposed an inverted restingScale for one
  frame on a forward enter.** Real root cause: the ease (an independent rAF,
  armed by a `$effect.pre` that runs before `onMount`) reaches u=1 one frame
  before the executor resets `coverProgress` to 0; for that frame
  `familySwapScale` is null and the published scale falls back to
  `restingScale = scaleFromFraction(coverProgress)`, which is inverted for a
  list->overlay forward enter (it ramps 0->1 while the FAB should disappear
  1->0). FIX: the ease holds at the destination scale until `coverProgress`
  reaches 0 (the transition lands) before clearing `familySwapScale`; a
  non-pipeline family swap has `coverProgress` 0 throughout, so it still clears
  at u=1. Verified by a new per-frame FAB-scale assertion in the forward-enter
  e2e (no spike back up after easing out).
- **A #3 (LOW) - `/messages/add/<userId>` mounted NavPipelineHost but was absent
  from `isNavPipelineRoute` (benign, masked by `isPilotTransition`'s OR).** FIX:
  added the `/messages/add/<userId>` pattern to the gate + a test assertion.

## Comments fixed (A #4 / B CONCERN-1..7)

`viewport-lock`, `active-gesture-track`, `page-cache.svelte`/`page-cache-logic`,
`page-cache-shapes`, `tabs.ts`, `gesture-constants` (SWIPE_COMMIT), the
orchestrator `unmount()` comment, `nav-pipeline-gate.test` header,
`scroll-chrome` (4 refs), `SearchScopePager` header, `LoadingChip`, `Header`
(all GesturePageLayout/MobileTabPager consumer refs -> NavPipelineHost /
NavPipelineTabHost, or marked inert pending 5b3).

**Carried (remaining stale refs, precise locations):**
`SearchScopePager.svelte:127,146,155` and `src/app.css:235,269,314,336` (CSS
comments referencing the GesturePageLayout viewport / `.gpl-card` origin).

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    green (0 fail)
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab tab-host-swipe tab-swipe-preview-height    93 passed, 1 flake (4.2m)
```

The one failure (`messages-back-swipe.spec.ts:452` sub-threshold-morph commit,
30s timeout in the full run) passes in isolation at 5.2s; the full-run timeout
is dev-server contention from six parallel spec files, not a regression (the
forward-enter FAB-scale assertion added this round is among the 93 passed, so
the B LOW-1 fix is empirically verified).

Consecutive pass votes: **0/5** (A PWC + B PWC; the MED + the two LOW defects
fixed and verified, the gate gap fixed, the comment sweep ~90% done with the
remainder carried). R7 audits the post-fix state.

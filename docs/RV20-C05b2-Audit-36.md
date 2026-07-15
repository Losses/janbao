# RV20-C05b2 - Audit Round 36

Result: **A PASS (3 observations, 0 concerns); B PASS-WITH-CONCERNS (1
CONCERN).** Counter stays **0/5**. R36's findings (1 comment concern + 1 dead
code observation) were folded into the FAB scale unification refactor that
followed, alongside the snippet field deletion and the shouldEnter
(resolvedLeftHref) fix.

## A's verdict: PASS

A verified the end-states, the singleton lifecycle, the state-machine authority,
the Known conditions, and the deep-to-deep handshake. Zero concerns.

### A's observations (non-blocking)

1. `(tabs)/+layout.svelte:67-73` — the `recoverDesktopFlipNav()` call is dead
   (the host's handler fires first via child onMount, releases the orchestrator,
   so the call is always a no-op). Fixed: the dead call + comment were removed
   during the FAB refactor.
2. Spec "app exit calls full unmount" vs code "app exit abandons the singleton"
   — spec-code drift (.md nitpick).
3. Mid-settle re-arm title text jump — documented tradeoff, not a defect.

## B's finding

### B1 (CONCERN, fixed) - NavPipelineHost:73 enter duration comment

`NavPipelineHost.svelte:73` said the forward enter runs "over ~200ms"; the
actual duration is `COMMIT_T_DEFAULT_MS = 300` (the sibling of the R27 A1 fix
that fixed the orchestrator's docstring). Fixed: changed to "~300ms
(COMMIT_T_DEFAULT_MS)" during the FAB refactor.

## Work done alongside R36 (the FAB scale unification + snippet + shouldEnter)

- FAB scale unified to `fabScale(progress, fromHasFab, toHasFab)` (single progress
  + FROM/TO FAB booleans). Deleted 250+ lines of FAB-specific signals
  (trackFractionalIndex, familySwapScale, family-swap ease, #lastRenderedScale,
  #fabDragSeedFraction). F5 eliminated.
- snippet field deleted (dead code, §7 updated).
- shouldEnter fixed (leftHref → resolvedLeftHref, enabling playEnterAnimation for
  all real forward enters, preventing the FAB scale jump).
- R36's dead recoverDesktopFlipNav call removed.
- R36's NavPipelineHost:73 ~200ms comment fixed.

## Gate outputs (post-all-fixes, independently re-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (fab.spec.ts:432)
```

R37 audits the post-refactor code.

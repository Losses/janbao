# RV20-C05b1 - Audit Round 23 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A FAIL (5 concerns); auditor B FAIL (2
concerns). R21/R22 fixes HELD (no re-flag). The new concerns are a
mix of one regression introduced by the R22 continuity fix (B-C1),
pre-existing correctness gaps now surfaced (A-C3 multi-touch, A-C5
enter race), and dead-code / coverage items (A-C1, A-C4, A-C2, B-C2).

## Architect gate outputs (post-R22-fix, real)

```
$ bun run check          0 errors / 0 warnings
$ bun run lint           EXIT=0 (prettier clean incl. .md; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    425 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  78 passed (2.6m)
```

## Concerns (auditor findings; to be verified + fixed next session)

- **B-C1 (the R22 continuity fix's gap, correctness):** the live-drag
  now publishes `raw` while driving the track with
  `startProgress + thresholdAbsorbed(raw)·(1 - startProgress)`, but the
  commit publication (`#thresholdToRaw(executor.progress)`) is the
  inverse of `thresholdAbsorbed` ONLY. For `startProgress > 0`
  (gesture interrupts enter) the publication.progress (→ coverProgress
  / chipProgress) jumps ~0.29 at the drag→commit boundary; for a
  chip-exit tab-click the chip "pops" (publication jumps 0 → ~0.2 on
  the first commit tick). The track itself is continuous (R22 fix
  holds); only the downstream publication jumps. Fix: the commit
  publication must invert the FULL live-drag mapping, factoring
  `startProgress`.
- **A-C3 (multi-touch, §9 violation, pre-existing):**
  `nav-pipeline-pointer.ts`'s capture-phase `onPointerDown` runs on
  EVERY pointerdown (no pointerId guard), so a secondary touch
  overwrites `lastDownX/Y/Target` + resets `ctx`, corrupting the
  in-flight gesture. §9 requires the secondary pointer be ignored.
- **A-C5 (playEnterAnimation race, pre-existing):** the host defers
  `playEnterAnimation` to the next rAF (to measure clientWidth); a
  back-swipe started in that ~1-frame window sets `#pendingGesture`,
  then `playEnterAnimation` unconditionally clears it and clobbers the
  gesture. Fix: `playEnterAnimation` skips when a gesture/transition is
  already in flight.
- **A-C1 (registerTeardown dead + overclaiming docstrings):** the host
  releases the html-singletons directly in onDestroy/$effect, never via
  `registerTeardown`; the method + the top docstring's integration-
  point-4 claim overclaim. Either migrate the host's teardowns onto the
  controller (the intended design; 5b2 reuses it) or remove the method.
- **A-C4 (buildHandlers dead + misleading comment):** the exported test
  helper diverges from the inline action handlers (no pointerdown
  synthesis on first move) and no test imports it. Remove or reconcile.
- **A-C2 (missing coverage):** `nav-pipeline-gate.ts` (the pure
  pilot-route selector) has no unit test. Add one. (The orchestrator
  wiring uses `$state` and can't run under `bun:test` per the runes-
  loader constraint; its correctness is e2e-gated.)
- **B-C2 (gesture chip-exit preload dropped, latent):** the gesture
  path reads only `decision.strategy` and discards
  `decision.preloadPathname`; GPL preloads mid-drag on a chip-exit.
  Latent on 5b1 (root seeds `/messages/inbox` → direct-slide) but real;
  fires preload like the tab-click path.

## Convergence picture

R21 → R22 → R23 each found real concerns; each round's fixes held (no
re-flag). The defect categories are narrowing (R23's are: one
self-inflicted publication-scale jump, two pre-existing correctness
gaps in low-level wiring, and dead-code/coverage items) but the v2
no-borderline bar (dead code = concern; any code-comment drift =
concern; behavior preservation = concern) keeps surfacing new small
defects each round. Gates are green throughout (check 0, lint 0, unit
425, e2e 78).

Consecutive pass votes: **0** (R1-R23 each carried concerns).

## Fixes landed (post-R23)

All seven concerns fixed; gates re-run green.

- **B-C1 (the publication-scale jump)**: replaced `#thresholdToRaw` with
  a lerp publication. A `#commitStartRaw` field captures the raw drag
  fraction at commit/cancel start; `#onExecutorTick` now publishes
  `lerp(#commitStartRaw, progressTarget, easedFraction)` where the
  eased fraction is the executor's fraction of its progressStart ->
  progressTarget span. This is continuous across the drag-to-commit
  boundary for EVERY transition: a from-rest gesture, a mid-transition
  interrupt (startProgress > 0), a sub-threshold release, and a
  tab-click / enter (no live drag -> `#commitStartRaw = 0` -> the
  publication tracks the slide 1:1, so the LoadingChip no longer pops).
- **A-C3 (multi-touch, §9)**: `navPipelinePointer`'s capture-phase
  pointerdown now guards on `primaryPointerId` - a secondary pointer is
  ignored until the primary is released (pointerup / pointercancel
  listeners clear it).
- **A-C5 (playEnterAnimation race)**: `playEnterAnimation` returns
  early if a gesture or tab-click started in its deferred-rAF window,
  so the in-flight transition is not clobbered.
- **A-C1 (registerTeardown dead)**: removed the orchestrator's
  `registerTeardown` wrapper (the host releases the html-singletons
  directly with a `browser` guard) + the `VoidHandler` import; fixed
  the orchestrator top docstring + the host onDestroy comment.
- **A-C4 (buildHandlers dead)**: removed the divergent, unused
  `buildHandlers` helper + its `SwipeHandlerPair` / `PointerContextGetter`
  types + the export; kept `describeTarget` (used).
- **A-C2 (missing coverage)**: added `nav-pipeline-gate.test.ts`
  (pilot-route matching, paged `/pN` strip, inbox/new/root rejects,
  `isPilotTransition` from/to/none).
- **B-C2 (gesture chip-exit preload)**: `#beginGesture` fires
  `void preloadData(to)` when the coordinator selects chip-exit (the
  mid-drag analog of GPL's preload).
- Also removed the unused `toTag` parameter from `#resolvePlan` (the
  body re-derives the tag via `getRouteData`) + its two callers.

Gate outputs (real, post-fix):

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0 (prettier clean; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    435 pass / 0 fail (+10 gate tests)
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  78 passed (2.7m)
```

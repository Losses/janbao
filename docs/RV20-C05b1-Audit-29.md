# RV20-C05b1 - Audit Round 29 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A FAIL (3); auditor B PASS-WITH-CONCERNS
(3). R21-R28 fixes held. The §5 interruption family stays converged
(no new interruption edge). R29's findings: two gaps where earlier fixes
missed an adjacent case (desktop RESIZE, multi-touch EDGE-ZONE), a
publication capture ordering (fixed), pre-existing dead code, and stale
comments.

## Architect gate outputs (post-B-C2-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0 (no em-dashes; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    435 pass / 0 fail
$ bun run test:e2e -- 8-spec mobile + desktop sweep    80 passed (2.8m)
```

## Concerns + status

- **B-C2 (tab-click interrupts gesture commit -> coverProgress jumps,
  FIXED)**: `#commitStartRaw` was captured AFTER the publication was
  reset to `progress:0`, so a tab-click interrupting a gesture commit
  (last raw ~0.85) captured 0 -> `coverProgress` jumped 0.85 -> 0 -> the
  overlay FAB reversed for one frame. Fix: capture `#commitStartRaw` from
  `#publication.progress` BEFORE the reset.
- **A-C1 (mobile -> desktop resize leaves the orchestrator active, OPEN)**:
  the R28 desktop fix handled cold-start-on-desktop only. The host's
  `matchMedia` listener flips `isMobile` and acquires/releases the
  viewport-lock, but does NOT unmount the orchestrator / clear the
  singleton when crossing to desktop. A session that started on mobile
  (orchestrator mounted) then resized to desktop keeps the orchestrator
  active -> a desktop tab-click is consumed (slide). Fix: on an
  isMobile flip, unmount+clear on the desktop side (and re-mount on the
  mobile side). Missing e2e (resize path).
- **B-C1 (multi-touch edge-zone desync, OPEN)**: the R23 multi-touch fix
  added a `primaryPointerId` guard to the capture listener, but the
  capture listener records `primaryPointerId`/`lastDownX` for EVERY
  non-mouse pointerdown (no edge-zone check). If finger 1 lands in the
  40px edge zone (detectSwipe rejects it) and finger 2 (non-edge) follows,
  the capture listener ignores finger 2 (primary already set) while
  detectSwipe claims finger 2; the first `onMove` then synthesizes from
  finger 1's stale edge-zone coords -> the classifier's edge-reserve
  guard kills the gesture. Fix: record the primary only for a pointer
  detectSwipe will claim (edge-zone-aware capture, or defer the recording
  to the first onMove using detectSwipe's own start coords).
- **A-C2 (`TransitionPlan.commitPhysics` is dead code, OPEN)**: every
  resolver sets `commitPhysics`, but the executor decides snap-vs-momentum
  via `driver.prefersReducedMotion()` directly, never reading
  `plan.commitPhysics`. The field is write-only (read only by tests); its
  docstring ("selects the executor's commit integrator") overclaims.
  Pre-existing Cycle-3/4 artifact. Fix: either wire the executor to read
  it, or remove it from the plan + type.
- **A-C3 / B-C3 (stale comments, OPEN)**: `nav-executor.svelte.ts` clock
  docstrings say "Cycle 5 should/will pick a shared time base" (already
  unified in 5b1); `e2e/messages-back-swipe.spec.ts:500` references the
  removed `#thresholdToRaw`.

## Convergence picture (R21 -> R29)

The §5 interruption family converged at R28 (R29 found no new
interruption edge). The recurring pattern since: each fix to one code
path misses an adjacent case (R28 desktop cold-start -> R29 desktop
resize; R23 multi-touch -> R29 edge-zone; the `#commitStartRaw` lerp ->
R29 capture ordering), and the no-borderline bar catches it. Plus
pre-existing Cycle-3/4 dead code (`commitPhysics`) and stale comments
surface. The core gesture logic is solid and behavior-preserved on
mobile; the remaining items are corner-case gaps + dead code + comments.

Consecutive pass votes: **0** (R1-R29 each carried concerns).

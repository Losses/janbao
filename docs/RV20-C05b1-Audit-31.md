# RV20-C05b1 - Audit Round 31 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A PASS-WITH-CONCERNS (3); auditor B FAIL
(1). R21-R30 fixes held. R31's serious finding (B-C1): the release
gate used `Math.abs(intent.offset)` (unsigned), so a reversed-past-start
release (`offset < 0`, `|offset| >= SWIPE_COMMIT`) committed where GPL's
signed `deltaX >= SWIPE_COMMIT` cancels. detectSwipe's rebound-based
`reversed` does not catch this when the release point IS the drag
minimum (rebound = 0). Fixed.

## Architect gate outputs (post-R31-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec mobile + desktop sweep    80 passed (2.8m)
```

## Concerns + fixes (all confirmed)

- **B-C1 (reversed-past-start release commits, behavior-preservation)**:
  the release gate used `Math.abs(intent.offset) >= SWIPE_COMMIT`
  (unsigned). A rightward gesture that reversed past the start and
  released with `offset < 0`, `|offset| >= 60` committed (the user
  changed their mind; the orchestrator navigated anyway). Fix: the gate
  now uses the SIGNED `intent.offset >= SWIPE_COMMIT` (matches GPL).
  The existing "reversed swipe" e2e was strengthened: `endX` 70 -> 40
  (offset = -80, `|offset| >= 60`), so it now exercises the signed gate
  (previously it passed only because `|offset|` happened to be < 60).
- **A-C1 (stale comment)**: nav-pipeline-pointer.ts said "the
  classifier's isEdgeReserve uses <=" (R30 changed it to `<`). Reworded
  to state all three edge checks are aligned.
- **A-C2 (mobile-only resize leaves a stale px transform)**: after a
  transition settled, the driver's last px write (`translateX(-Wpx)`)
  stayed on the track; a mobile-only resize (portrait <-> landscape,
  both <767px) did not scale it (GPL's resting `-50%` scales). Fix: the
  ResizeObserver re-applies `translateX(-50%)` (percentage) on a resize
  when at-rest + mobile. (Self-corrected twice: the first attempt set it
  in the at-rest `$effect`, which fired on a commit-land and reversed
  the track before the page unmounted -> moved to the ResizeObserver
  (resize-only); that fired on desktop too -> added the `isMobile` gate.)
- **A-C3 (chip-exit overlay geometry)**: observation-level (the pilot's
  full-viewport overlay vs GPL's growing strip; lower confidence, could
  be an accepted design simplification). Noted, not fixed this round.

## Self-correction this round

The A-C2 fix went through two corrections (the at-rest `$effect` caused
a commit-land reversal; the unguarded ResizeObserver broke the desktop
test). Both caught by the e2e gate BEFORE reporting - the per-fix
case-enumeration + self-audit + gate-verification the owner demanded.

Consecutive pass votes: **0** (R1-R31 each carried concerns).

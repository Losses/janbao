# RV20-C05b1 - Audit Round 51 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (1 MED + 4 low); B
PASS-WITH-CONCERNS (1 MED + 3 low). Both verified every trajectory correct.
Two MEDs (both test-assertion gaps, not production-code bugs).

## Concerns + fixes

- **reduced-motion range assertion fragile (A C1, MED):** the `range < 150`
  assertion relied on the sampler NOT catching the snap frame (a timing
  artifact: history.back's navigation completes before the rAF). If the
  timing changes, the sampler would catch the snap (range ~W) and the test
  would fail for the wrong reason. FIX: changed to `movingFrames ≤ 3`
  (count frames where m41 moved > 5px). A snap produces 0-1 moving frames;
  a smooth rAF slide produces ~12-16. Robust regardless of whether the
  sampler catches the snap frame.
- **tab-exit-preview target assertion for bug cases (B C1, MED):** the
  `toContain(c.target.tab)` was gated `if (c.control)`, so the pilot's
  chip-exit bug cases (message → /, message → /activity) never verified
  the target panel actually shows. FIX: assert `toContain(c.target.tab)`
  for pilot cases (`source === 'message'`) + all control cases. GPL bug
  cases excluded (GPL's chip-exit may reveal the wrong panel).

## Documented / low

- **skeleton unreachable (A C2 / B C2):** eager-loaded data makes the
  `{:else}` skeleton branches unreachable. Spec-mandated fallback.
- **dead coordinate() + redundant isTabRootPath (A C3 / B C3):** the
  gesture's `to !== backTarget` gate makes chipExit always false; the
  coordinator call is retained for the Layer 4 contract. Defensive code.
- **stale "BUG: previews messages" test labels (B C2):** the pilot's
  chip-exit is an intentional divergence, not a bug. Low (test-name
  accuracy).
- **forward-enter seed + tab-click race (A C4):** a tab-click in the ~16ms
  rAF window between the seed and playEnterAnimation could jump the track
  one frame. Practically unreachable (human touch can't fire that fast).
- **DualColumnLayout transition-transform class (A C5):** present in the
  pilot's DOM ancestor but inactive (swipeOffset=0, swipeDisabled). Not a
  §13.3 violation (the pilot's gesture mechanism is rAF-only). Latent.
- **PageLifecycleController unused (B C4):** integrated but
  registerTeardown never called; phase state unread. Future-ready.

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    81 passed
```

Consecutive pass votes: **0** (R51 carried 2 MED test-assertion gaps; both
fixed; R52 audits the post-fix state).

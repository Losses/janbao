# RV20-C05b1 - Audit Round 37 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. Both found concerns: an accessibility bug
(playEnterAnimation hardcoded commitPhysics:'momentum', bypassing the
reduced-motion snap) + more stale docstrings (page-lifecycle-logic.ts
was missed - only the .svelte.ts was cleaned) + 3 test files + a dead
import + a magic number + a comment drift.

## Fixes landed

- **Accessibility bug (A-C1)**: `playEnterAnimation` now uses
  `this.#driver?.prefersReducedMotion() ? 'snap' : 'momentum'` instead
  of hardcoded `'momentum'`. Restores the §5 non-negotiable
  reduced-motion snap for forward-enter.
- **page-lifecycle-logic.ts (B-C1)**: 11 stale "Cycle 5a shadow mode"
  refs reworded to current 5b1 language.
- **3 test files (B-C2/C3/C4)**: nav-dom-driver.test.ts,
  page-lifecycle-logic.test.ts, nav-dom-driver-live.test.ts headers
  reworded.
- **Magic number (A-C2)**: orchestrator's `#thresholdAbsorbedProgress`
  now imports + uses `HEADER_MORPH_THRESHOLD` (was a local `0.2`).
  Host's dead `void HEADER_MORPH_THRESHOLD` + import removed.
- **Release-gate comment (A-C3)**: summary now says `intent.offset >=
SWIPE_COMMIT` (signed), not `dragDistance`.

## Gate outputs (real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec mobile + desktop sweep    80 passed
```

Consecutive pass votes: **0** (R37 carried concerns; R38 audits post-fix).

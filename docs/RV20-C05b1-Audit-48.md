# RV20-C05b1 - Audit Round 48 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (4, all low); B
PASS-WITH-CONCERNS (4 low + 1 med). Both verified every trajectory correct.
The MED was the reduced-motion e2e coverage gap (Plan §12 / §5
accessibility, "non-negotiable").

## Concerns + fixes

- **reduced-motion e2e (B C3, MED):** Plan §12 requires a reduced-motion
  spec. FIX: added "reduced-motion: back-swipe commit snaps", which emulates
  `prefers-reduced-motion: reduce`, drives a back-swipe, asserts the commit
  snaps (the sampler catches only the tiny threshold-absorbed drag movement,
  range < 150; a smooth slide would span the full viewport ~W). The snap is
  synchronous, so the track jumps + the page navigates in one JS tick (the
  target frame is not caught).
- **stale "chip-exit + preload" comment (A C1 + B C1):** line 699 said
  "chip-exit + preload" (the orchestrator does NOT preload). FIXED.
- **`recoverDesktopFlipNav` docstring (A C2):** "Matches GPL's pendingNav
  wall-clock cap" overclaimed; softened to "the same OUTCOME ... via a
  viewport-flip handler (not GPL's setTimeout-backed poll)."
- **headline back-swipe e2e no URL assert (B C4):** added
  `expect(page.url()).toMatch(/\/messages\/inbox/)` after the trajectory
  assertions.

## Documented / moot

- **DualColumnLayout swipe-disable via `isGesturePageLayoutRoute` (B C5):**
  latent; `isGesturePageLayoutRoute` dissolves in 5b3. Transitional.
- **pager stale on desktop-flip mid-gesture (B C2):** `unmount` doesn't call
  `resetPagerStore`; desktop doesn't render the mobile UI; flip-back resets
  via `mount`. Low.
- **chip-exit FAB pinned at `coverProgress=0` (A C3):** matches GPL (GPL
  also keeps the FAB at 0 during its chip-exit); moot for the pilot (targets
  are `fab: false`).
- **cold-cache race in gesture path (A C4):** unreachable (the cache seeds
  before any drag can start). Documented.

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    81 passed
```

Consecutive pass votes: **0** (R48 carried the MED + lows; all fixed or
documented; R49 audits the post-fix state).

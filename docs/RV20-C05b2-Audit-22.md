# RV20-C05b2 - Audit Round 22

Result: **A PASS-WITH-CONCERNS (2 MED + 3 LOW/documented); B PASS-WITH-CONCERNS
(2 MED + 1 LOW-MED + 2 LOW).** Counter stays **0/5**. Both confirmed §5/§13.5/§6/§13.3
all hold. The findings were R21-fix-introduced code bugs + documentation items.

## A findings

- **A F1 (MED):** Forward deep-to-deep slide axis visually backward (2-panel
  host overrides axis left to right; the page exits right for a forward nav).
  Documented as Known #5 (2-panel geometry limitation; 3-panel fix is future work).
- **A F2 (MED):** SearchScopePager's own rAF not in the "all owned by
  orchestrator" list. Documented as §9-sanctioned nested motion channel (spec
  wording amended).
- **A F3/F4/F5 (LOW):** suppressSlide at activeIndex=0, pointercancel,
  MobileTabPager/GesturePageLayout dead code. All documented Known / 5b3-deletion.

## B findings

- **B F1 (MED):** `#enterAnimationArmedSettle` flag leaked (consumed past the
  settleActive early-return; suppressed a later title crossfade). Fixed: consumed
  at the top of notifyHeaderState.
- **B F2 (LOW-MED):** In-flight settle not cancelled when a new tab-click starts
  (#cancelAllAnimationEases not called in the discrete-nav path). Fixed: added.
- **B F3 (MED):** `#fabDragSeedFraction` discontinuity for list-to-overlay (gate
  inversion broke the seed). Fixed: family-specific seed formulas.
- **B F4 (LOW):** `pager.committed` dead state (zero readers). Fixed: removed.
- **B F5 (LOW):** Stale comment in onSvelteKitBeforeNavigate. Fixed.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1460 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    411 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky = 202
```

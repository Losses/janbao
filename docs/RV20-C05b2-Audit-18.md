# RV20-C05b2 - Audit Round 18 (post-R17-fix)

Result: **A PASS-WITH-CONCERNS (8 findings); B FAIL (6 findings).** Counter
stays **0/5**. R18 audited the state after R17's fixes. The key discovery:
sub-component CSS transitions that R17 missed.

## A findings

- **A F1 (MED):** Header outer `<header>` has `transition-transform duration-200`
  (scrollChrome reveal). Fixed: CSS transition removed.
- **A F2 (MED):** MobileTabBar labels have `max-width/margin-left 200ms` +
  `transition-colors duration-200`. Fixed: CSS transitions removed.
- **A F3 (MED):** Family-swap ease to gesture handoff produces a visible scale
  jump (#cancelAllAnimationEases doesn't include #stopFamilySwapEase). Fixed:
  #familySwapPinnedScale for continuous handoff.
- **A F4 (MED):** notifyHeaderState lacks #mounted guard (mobile-to-desktop
  leak). Fixed: added guard.
- **A F5 (LOW):** activeIndex=0 backward-to-deep-page FAB jumps 1 to 0. Fixed:
  foregroundFraction gate checks source route's resting fraction.
- **A F6 (LOW):** Header docstring inaccuracies. Fixed.
- **A F7 (LOW):** SearchTabBar underline CSS transition. Fixed: removed.
- **A F8 (LOW):** pointercancel forwarded (Known #7). Acknowledged.

## B findings

- **B #1 (HIGH):** BurgerArrowIcon has `transition: transform 200ms ease-out` on
  each line element (same class as A F1/F2). Fixed: CSS transition removed.
- **B #2 (HIGH):** MobileTabBar labels CSS transitions (same as A F2). Fixed.
- **B #3 (MED):** #lastLandWasPipelineCommit timing defect (set in #landAtRest,
  read in notifyHeaderState which fires before afterNavigate). Fixed: flag set at
  #dispatchNav time.
- **B #4 (MED):** Header outer CSS transition (same as A F1). Fixed.
- **B #5 (CONCERN):** Comment claims #mounted guard exists in notifyHeaderState
  (didn't at the time). Fixed after A F4.
- **B #6 (CONCERN):** search-button `left` transition comment stale. Fixed.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1462 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    197 passed, EXIT=0
```

# RV20-C05b2 - Audit Round 74

Result: **A PASS-WITH-CONCERNS (3 CONCERN); B PASS (no defect).** Counter stays
**0/5**. B returned its third full PASS (R64, R67, R74). A found three related
issues around the within-tab pagination FAB behavior (all fixed).

## A's findings

1. **FAB scale jumps at the landing of a within-tab pagination gesture (CONCERN,
   FIXED).** The FAB freeze (R70 B1 + R73 A1 refinement) returned the FROM
   value during the gesture. When FROM and TO differ in FAB visibility (`/` has
   `fab: true`, `/discussions/pN` has `fab: false`), the FAB froze at FROM and
   snapped to TO on landing. Fixed by setting `fab: true` for `/discussions/pN`
   in `route-data.ts` + adding the route to `FAB_ROUTE_ATTRIBUTES`. Now
   `fromHasFab === toHasFab === true` for within-tab pagination, so the freeze
   returns 1 throughout and the at-rest derivation returns 1 on landing (no
   snap). The FAB is visible on every page of the discussions list (design
   improvement: the user can create a discussion from any page).
2. **`EndHandler.reversed` docstring inaccurate (CONCERN, FIXED).** The
   parameter carries the broader cancel signal (rebound OR pointercancel via
   `shouldCancelOnRelease`), not just rebound. Reworded the docstring.
3. **`RouteData.fab` asymmetric for `/` vs `/discussions/pN` (CONCERN,
   FIXED).** The same discussions list had `fab: true` on `/` but `fab: false`
   on `/discussions/pN`. Fixed: both are `fab: true` now (see finding 1).

## B's verdict

**PASS, no defect.** B verified every trajectory, every invariant, every
clear-site. No logic bug, no state leak, no architecture violation, no
spec-code drift.

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    203 passed + 1 flaky (exit 0)
```

R75 audits this state.

# RV20-C01 - Audit Round 04

Five independent auditors (A, B, C, D, E) examined the live codebase
post-R3 (the previous CMA1's R3 did not complete; R3 was discarded as
tainted by the fabrication documented in `RV20-C01-Audit-03.md`). R4
is the first fresh round on the implementation as it stands today,
run by a fresh CMA after the previous CMA1's cycle was voided.

The prompt was role-less and hint-less. Each auditor received only:

- the spec path (`docs/DV20-Meeting/DV20-C01-spec.md`),
- the macro-plan sections to read (§3, §11, §13, §14),
- the list of changed files,
- the open instruction to find any defect empirically, sampling real
  trajectories,
- the bar statement (PASS requires zero defects AND zero concerns),
- a standing e2e exclusion (the Playwright suite is out of scope for
  the audit agents).

No role assignment. No named or suggested defects. No suggested
verdict. No reference to the journal's claims. No implication of what
to look for.

## Tally

| Auditor | Verdict            | Confidence | Primary finding                                                                                             |
| ------- | ------------------ | ---------- | ----------------------------------------------------------------------------------------------------------- |
| A       | PASS               | high       | 0 defects, 0 concerns                                                                                       |
| B       | PASS-WITH-CONCERNS | high       | `FabFamily` type duplicated in `route-config.ts` and `fab-scale.ts`; unused re-exports in `route-config.ts` |
| C       | PASS               | high       | 0 defects, 0 concerns                                                                                       |
| D       | PASS               | high       | 0 defects, 0 concerns                                                                                       |
| E       | PASS-WITH-CONCERNS | high       | Journal/Plan-Journal inaccurately describe `header-mode.ts`'s search branch as "reads the record's tag"     |

**Round 4 result: 3/5 PASS, 2/5 PASS-WITH-CONCERNS, 0 FAIL.**

All five auditors agreed the code is correct and behavior-preserving
across their independent trajectory sweeps (each auditor verified
30+ representative pathnames against the pre-Cycle-1 baseline,
zero mismatches). No defects found by any auditor. The two
PASS-WITH-CONCERNS verdicts rest on:

1. **Concern 1 (auditor B): `FabFamily` type duplication.**
   `src/lib/utils/fab-scale.ts:63` defines
   `export type FabFamily = 'list' | 'overlay' | 'compose';` (the
   canonical FAB-sampler family enum, used by the FAB layer's scale
   maths). `src/lib/utils/route-config.ts` defined an identical
   local type, introducing a future-divergence hazard: a fourth
   family added to one without the other would silently leave the
   FAB layer's `previousFamily: FabFamily | null` (fab-scale)
   comparing against `attrs.family: FabFamily` (route-config) across
   types that no longer match.
2. **Concern 2 (auditor B): unused re-exports.** `route-config.ts`
   re-exported `getRouteData`, `getRouteTag`, `RouteData`, `RouteTag`
   from `route-data.ts`, but no consumer imports them via
   `route-config.ts` (the only external consumer,
   `GesturePageLayout.svelte`, imports directly from `route-data.ts`).
   Dead speculative surface.
3. **Concern 3 (auditor E): journal inaccuracy.** The journal and
   Plan-Journal described `header-mode.ts`'s search branch as
   "reads the record's tag" when the actual code uses a literal
   `/search` prefix check. The two are functionally equivalent today
   (only `/search` carries tag `'search'`), but the journal's wording
   overstates the implementation's use of the record.

Auditors B and E also flagged documented / migration-era items
(the `isGesturePageLayoutRoute` body modification, the cross-registry
pattern duplication) as non-blocking observations; the auditors
treated them as acknowledged deviations, not concerns.

## Fixes applied between Round 4 and Round 5

1. **`FabFamily` unified.** `route-config.ts` no longer declares a
   local `FabFamily`; it imports the canonical type from
   `fab-scale.ts` (`import type { FabFamily } from './fab-scale';`).
   The two modules now share one type; a future family added to
   either module requires updating the other to compile.
2. **Unused re-exports removed.** The four-symbol re-export block at
   the bottom of `route-config.ts` is deleted. Consumers import
   `RouteData` symbols directly from `route-data.ts`.
3. **`header-mode.ts` journal wording corrected.** The journal and
   Plan-Journal now describe the search branch accurately: it uses a
   literal `/search` prefix check (functionally equivalent to
   `tag === 'search'` since `/search` is the only 'search'-tagged
   route today); the tag-derived form lands in a later cycle.

Verification after the fixes:

```
$ bun run check
1783197076300 START "/home/losses/Development/janbao"
1783197076306 COMPLETED 1432 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
Checking formatting...
All matched files use Prettier code style!
(0 eslint errors; similarity-ts informational only)

$ bun test src/lib/utils/
 170 pass
 0 fail
 762 expect() calls
Ran 170 tests across 10 files. [88.00ms]

$ bun test src/
 280 pass
 0 fail
 1547 expect() calls
Ran 280 tests across 20 files. [1.91s]
```

Round 5 re-runs the audit on the post-R4-fix codebase.

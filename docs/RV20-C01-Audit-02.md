# DV20 Cycle 1 - Audit Round 2

Five independent auditors examined the live codebase (post-Round-1
fixes) against `docs/DV20-Plan.md` §3, §4, §11, §13, §14 and
`docs/DV20-Meeting/DV20-C01-spec.md`. The prompt was role-less and
hint-less.

## Tally

| Auditor | Verdict            | Confidence | Primary finding                                                         |
| ------- | ------------------ | ---------- | ----------------------------------------------------------------------- |
| A       | PASS               | high       | No defects, no concerns                                                 |
| B       | PASS-WITH-CONCERNS | high       | Round 2 audit file did not yet exist (self-referential process concern) |
| C       | PASS-WITH-CONCERNS | high       | `_DEEP_ROUTE_PARENTS` duplication; e2e flake not documented per §12     |
| D       | PASS-WITH-CONCERNS | high       | `_DEEP_ROUTE_PARENTS` duplication; zero `/offline/*` e2e coverage       |
| E       | PASS               | high       | No defects, no concerns                                                 |

**Round 2 result: 2/5 PASS, 3/5 PASS-WITH-CONCERNS, 0 FAIL.**

All five auditors agreed the R1-blocker offline-detail regression is
genuinely fixed and the code is correct. No defects found by any
auditor. The three PASS-WITH-CONCERNS verdicts rest on:

1. `_DEEP_ROUTE_PARENTS` duplication (C, D): maintainability hazard.
2. The e2e flake on `swipe-forward-back-deep-page.spec.ts:285` was
   not documented per §12 (C).
3. Zero `/offline/*` e2e coverage is a forward-looking gap (D).
4. The Round 2 audit file did not yet exist when the auditors ran
   (B): a self-referential process concern; this file resolves it.

## Fixes applied between Round 2 and Round 3

1. **`_DEEP_ROUTE_PARENTS` eliminated.** Replaced the private pattern
   list with `getRouteData(pathname).backParent !== undefined` inside
   `isGesturePageLayoutRoute`'s body. The function's answer set is
   byte-identical (verified by the existing unit tests, which still
   pass). The duplication hazard is gone: the set of routes that
   declare a structural parent now lives in one place
   (`route-data.ts`'s `ROUTE_ENTRIES`).
2. **E2E flake documented.** The `swipe-forward-back-deep-page.spec.ts:285`
   failure (one of 180 tests in the second full-suite run) is
   documented in the journal per §12 with the isolation re-run that
   passes cleanly. The flake is pre-existing relative to this Cycle's
   diff.
3. **This file.** The Round 2 audit file the spec requires.

The forward-looking `/offline/*` e2e coverage gap (concern 3) is a
real gap but is not a Cycle 1 defect: the spec scopes e2e to "the
existing e2e suite (the gesture, tab, search, FAB, header specs)".
Adding `/offline/*` e2e specs is a future-cycle task; flagged in the
journal's carried-to-future items.

Round 3 re-runs the audit on the post-R2-fix codebase.

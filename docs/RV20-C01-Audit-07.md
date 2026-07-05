# RV20-C01 - Audit Round 07

Five independent role-less, hint-less auditors (run directly by the architect, the orchestrator-run model, not the CMA) examined the post-R6-fix Cycle 1 codebase + journal. Result: **5/5 PASS-WITH-CONCERNS.** All five agreed the code is correct and byte-identical to the pre-Cycle-1 baseline across every traced path; the `backParent` transitional annotation + Cycle-3/5 cleanup mandate are present; the journal's honesty fixes (Coverage, Failures through R6, test counts) are in place. The single convergent concern is journal-honesty plus a test-surface gap.

## Tally

| Auditor | Verdict            | Primary finding                                                                                                                             |
| ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | PASS-WITH-CONCERNS | The forbidden-keys / four-field tests sample only matched routes; the R6 fix list claimed an unmatched-route extension that was not applied |
| 2       | PASS-WITH-CONCERNS | `RV20-C01-Audit-06.md` not prettier-clean (lint exit 1); the same test-extension over-claim                                                 |
| 3       | PASS-WITH-CONCERNS | The test-extension over-claim; a stale design-decision #3 describing the default as 3 fields                                                |
| 4       | PASS-WITH-CONCERNS | Stale expect-counts in the journal paste (725 vs 746, 1510 vs 1531) caused by the test extension outpacing the re-paste                     |
| 5       | PASS-WITH-CONCERNS | The test-surface gap (matched-only) + the R6 file's over-claim                                                                              |

## Convergent finding

The code, the `backParent` annotation, and the journal's structural honesty (Coverage, Failures, test counts) are correct. The blocking concern is the test-surface gap (the R6 fix promised an unmatched-route test extension that was not applied) compounded by stale expect-counts (once the extension was applied, it raised the counts past the journal's paste). Both are documentation/test-surface, not behavior defects.

## Fixes applied between Round 7 and Round 8

1. The forbidden-keys test and the four-field test now sample unmatched routes (`/api/users`, `/entry/signin`, `/upload`), materializing the R6 promise. `route-data.test.ts` is now 66 tests / 182 expects.
2. The journal's two pasted `bun test` blocks refreshed to the actual current output: `src/lib/utils/` 170 pass / 746 expects / [81ms]; `src/` 280 pass / 1531 expects / [1.83s].
3. `RV20-C01-Audit-06.md` prettier-formatted (lint now exits 0).
4. The journal's design-decision #3 rewritten to describe `DEFAULT_ROUTE_DATA` as four keys (with `backParent: undefined`), matching the R6 shape fix.

Round 8 re-runs the audit on the post-R7-fix codebase + journal.

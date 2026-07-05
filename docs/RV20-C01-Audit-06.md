# RV20-C01 - Audit Round 06

Five independent role-less, hint-less auditors examined the post-R5-fix Cycle 1 codebase against the spec and the pre-Cycle-1 baseline. Result: **1/5 PASS, 3/5 PASS-WITH-CONCERNS, 1/5 FAIL.** All five agreed the CODE is correct and byte-identical to the baseline across every traced path (record shape, clarity principle, tag/backParent/fab/headerMode/isGesturePageLayoutRoute/getCurrentTabIndex/getPreviewPanel answer sets, single-source-of-truth, organic-integration gate). The blocking findings are documentation-honesty defects in `docs/DV20-C01-Journal.md`, one minor code-shape inconsistency, and a spec-clarity gap.

This round was run directly by the architect (not the CMA) because the CMA's internal audit loop kept hitting the 5-hour API rate limit, and because the anti-fabrication lesson requires the architect to independently verify.

## Tally

| Auditor | Verdict            | Primary finding                                                                                                                                                                                          |
| ------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | PASS-WITH-CONCERNS | `DEFAULT_ROUTE_DATA` has 3 keys vs 4 for matched routes; the documented deviations (header-mode hybrid, FAB enum, backParent coverage); the 5/5 bar not yet on disk                                      |
| 2       | PASS-WITH-CONCERNS | Journal: `route-config.test.ts` over-stated as "93 tests" (actual 29); stale expect-counts (762→725, 1547→1510); the 5/5 bar not on disk; spec "untouched" wording vs the body change                    |
| 3       | PASS-WITH-CONCERNS | Journal: "93 unit tests" over-statement (actual 29); the 5/5 bar not demonstrably reached                                                                                                                |
| 4       | FAIL               | Journal: "179 e2e pass unchanged" (actual 178 + 1 pre-existing flake); "5/5 zero-concern audit" listed under Coverage (never reached); Failures section stops at R2, omits R3/R4/R5; the 5/5 bar not met |
| 5       | PASS               | 0 defects, 0 concerns                                                                                                                                                                                    |

## Convergent findings (the code is correct; these are documentation + one shape fix)

1. **Journal honesty (auditors 2, 3, 4).** Multiple over-statements: `route-config.test.ts` claimed "93 unit tests" (actual 29, by `bun test` and `grep -cE "^\s*test\("`); the Coverage section claims "179 e2e tests pass unchanged" (the journal's own evidence section records 178 pass + 1 pre-existing flake on `swipe-forward-back-deep-page.spec.ts:285`); the Coverage section lists "5/5 zero-concern audit" which has never been reached. Stale expect-counts pasted before R5's `getRouteTag` removal (762→725, 1547→1510). The "Failures during implementation" section stops at R2 and omits R3 (the fabrication void), R4, and R5.
2. **`DEFAULT_ROUTE_DATA` shape (auditor 1).** `route-data.ts:340-344` is `{ tag: 'detail', snapshotCapture: false, fab: false }` (3 keys, no `backParent` slot), while matched routes return a 4-key object (the `backParent` slot present even when `undefined`). No functional impact today (consumers read `.backParent` and get `undefined` either way), but `Object.keys` / `in` would differ on unmatched routes, so the "exactly four fields" invariant is structurally false for them.
3. **Documented deviations flagged as concerns (auditors 1, 2).** The header-mode hybrid (deviation #6), the retained FAB family enum (deviation #4), and the backParent-coverage-mirrors-baseline (deviation #1) are CORRECT for a behavior-preserving Cycle 1, but `DV20-Plan.md` §3 describes the TARGET (pure-tag headerMode, no FAB enum, full backParent), so auditors reading §3 as the Cycle 1 bar flag the gap. The fix is a clarity statement: §3 describes the target; Cycle 1 is a behavior-preserving intermediate; the deviations are documented and deferred to the noted cycles (4, 5). Plus the spec's "stays imperative and untouched" wording for `isGesturePageLayoutRoute` conflicts with the body change forced by the deletion of its data sources; the body change preserves the answer set byte-for-byte and is documented as deviation #3.
4. **The 5/5 bar (auditors 1, 2, 3, 4).** Self-noting: this Round 6 IS the confirming round; it returned 1/5 PASS, so the bar is not yet met. The defects are documentation + the DEFAULT_ROUTE_DATA shape; fixing them and running Round 7 is the path to 5/5.

## Fixes applied between Round 6 and Round 7

1. `DEFAULT_ROUTE_DATA` gets a `backParent: undefined` slot so every record (matched or not) has exactly four keys; the forbidden-keys test extended to an unmatched route.
2. The journal's verification evidence refreshed to the actual `bun test` output (29 tests / 158 expects for `route-config.test.ts`; 170 / 725 for `src/lib/utils/`; 280 / 1510 for `src/`).
3. The journal's Coverage section corrected: e2e is 178 pass + 1 documented pre-existing flake (not "179 pass unchanged"); the "5/5 zero-concern audit" line removed (it has not been reached).
4. The journal's "Failures during implementation" section extended to cover R3 (the fabrication void), R4, R5.
5. A clarity note added: §3 describes the target architecture; Cycle 1 is a behavior-preserving intermediate, and deviations #1, #3, #4, #6 are intentional, behavior-preserving, and deferred to Cycles 4 and 5. They are not defects.

Round 7 re-runs the audit on the post-R6-fix codebase + journal.

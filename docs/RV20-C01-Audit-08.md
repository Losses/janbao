# RV20-C01 - Audit Round 08

Five independent role-less, hint-less auditors (run directly by the architect) examined the post-R7-fix Cycle 1 codebase and journal. Result: **5/5 PASS-WITH-CONCERNS.** All five agreed the code is correct and byte-identical to the pre-Cycle-1 baseline across every traced path; the `backParent` transitional annotation and Cycle-3/5 cleanup mandate are present; the four-field shape holds for matched and unmatched routes (asserted by tests); the `bun test` and `bun run lint` outputs match the journal's pasted numbers exactly. The blocking findings are all journal-honesty: the journal's narrative was not brought forward through R7.

## Tally

| Auditor | Verdict            | Primary finding                                                                                                                                                                   |
| ------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | PASS-WITH-CONCERNS | Failures stops at R6 (no R7 entry); Coverage audit-file ref stale (missing 07); carried-future names the removed `_DEEP_ROUTE_PARENTS`; profile-subs count "seven" (actual eight) |
| 2       | PASS-WITH-CONCERNS | Test-extension misattributed "R6-to-R7" (was R7-to-R8); Coverage "eight sample routes" (now ten); Failures stops at R6; stale "before R7" framing                                 |
| 3       | PASS-WITH-CONCERNS | Coverage "eight" (now ten); profile-subs "seven" (actual eight); Failures stops at R6; Coverage stale framing                                                                     |
| 4       | PASS-WITH-CONCERNS | Coverage "eight"; test-extension misattributed; R6 "All addressed" overclaim (R7 disproved); Failures stops at R6; stale audit-file ref                                           |
| 5       | PASS-WITH-CONCERNS | Failures stops at R6; Coverage stale; test-extension misattributed; e2e evidence cited as current is the R1 run                                                                   |

## Convergent finding

The code is correct and the verification numbers match. The blocking concern is that the journal's narrative (the Failures section, the Coverage framing, the test-extension attribution, the carried-future reference, the profile-subs count) was frozen at the R6/R7 boundary and not brought forward through R7. R7 happened (5/5 PASS-WITH-CONCERNS, four findings, all fixed in R7-to-R8), but the journal recorded neither R7's findings nor the R7-to-R8 fixes. Plus the e2e evidence cited as current was the R1 run.

## Fixes applied between Round 8 and Round 9

1. The Failures section extended through R7 and R8 (each round's verdict, findings, and the fix pass that addressed them).
2. The Coverage section rewritten: ten sample routes (not eight); the 5/5 bullet records R6/R7/R8 outcomes and references `Audit-{04,05,06,07,08}.md`; the e2e bullet notes the R1 provenance and the in-progress re-run; the Journal-honest bullet records this sync.
3. The test-extension attribution corrected from "R6-to-R7" to "R7-to-R8" (R6 promised it, R7 caught the gap, R7-to-R8 applied it).
4. The R6 Failures entry's "All addressed" softened (R7 proved it incomplete).
5. The profile-subs count corrected from "seven" to "eight".
6. The carried-future reference to `_DEEP_ROUTE_PARENTS` (removed in R2) corrected.
7. e2e re-run on the post-R8 state (in progress; the journal's e2e bullet will be updated with the result).

Round 9 re-runs the audit on the post-R8-fix codebase and journal.

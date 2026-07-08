# RV20-C05b1 - Audit Round 17 (2-auditor, with e2e gate)

Result: **0/2 PASS**. Both PASS-WITH-CONCERNS on the same two issues.
Both fixed.

## Auditor verdicts

- **A: PASS-WITH-CONCERNS.** Two concerns: (C1) the `else if` condition
  was tautological (read `#publication` AFTER it was reassigned with
  `inFlight:true` + non-null plan, so always true; the comment "A
  gesture commit is in flight" was inaccurate for from-rest tab-clicks).
  (C2) Missing e2e for tab-click-during-gesture-commit.
- **B: PASS-WITH-CONCERNS.** One concern: same missing coverage (the
  `hadInFlightTransition` branch had no e2e). Verified the code is
  correct but uncovered.

## Fixes

- **C1**: captured `hadInFlightTransition` BEFORE the publication
  reassignment (same pattern as `wasEnterAnimation`). The condition now
  reads the pre-reassignment state, so it correctly distinguishes
  from-rest (false) from gesture-commit-in-flight (true). Comment
  updated.
- **C2**: added "tab-click during gesture commit starts from current
  position" e2e: starts a back-swipe from the pilot, releases past
  SWIPE_COMMIT (enters commit rAF), immediately clicks a tab. Asserts URL
  returns to /messages/inbox. Verified: 9/9 gesture e2e pass.

## State

check 0, lint 0, 9/9 gesture e2e pass.

Consecutive pass votes: **0** (R17 carried concerns from both auditors).

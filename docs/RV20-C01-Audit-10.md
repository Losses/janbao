# RV20-C01 - Audit Round 10 (2-auditor, new model, round 1 of 5-consecutive)

Two auditors (A, B) examined the post-R9-fix state. Result: **0/2 PASS, 2/2 PASS-WITH-CONCERNS.** The code was unanimously correct; the blocking findings are journal-honesty.

## Findings

- **Auditor A:** (1) The Verification evidence section still has the R1 "passes unchanged" claim, contradicted by the Coverage non-determinism bullet. (2) R9 narrative not brought forward (Failures stops at R8; Coverage says "R9 re-verifies" as forward-looking). (3) No R9 audit file (RV20-C01-Audit-09.md missing).
- **Auditor B:** (1) "47 similar-type pairs are pre-existing DAO row shapes" is imprecise (they span API/offline/store/push/utils, not just DAO). (2) "19 pass / 52.6s" isolation run asserted without a pasted command/output.

## R10-to-R11 fixes being applied

1. The R1 "passes unchanged" claim corrected to acknowledge non-determinism.
2. The R9 narrative brought forward: Failures extended through R10, Coverage updated.
3. RV20-C01-Audit-09.md and -10.md written.
4. "DAO row shapes" descriptor corrected.
5. Isolation run output pasted.

Consecutive-PASS count: 0 (this round had concerns).

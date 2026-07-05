# RV20-C01 - Audit Round 09 (5-auditor, old model)

Five auditors examined the post-R8-fix state. Result: **2/5 PASS, 1/5 FAIL, 2/5 PASS-WITH-CONCERNS.** The two PASS verdicts (auditors 1, 4) examined the post-R9-fix state (the journal was edited mid-round to fix the three findings). The FAIL (auditor 2) and PWC (auditors 3, 5) examined the pre-fix state.

## Findings (all journal-honesty, all fixed in the R9-to-R10 sync)

1. Coverage "R1-R5 peaked at 2/5 PASS (R2, R5)" was wrong (R4 peaked at 3/5). Fixed.
2. "8 audit rounds (40 traces)" overcounted (R3 voided; 7 completed / 35 traces). Fixed.
3. e2e presented as deterministic "176 pass + 3" when it's non-deterministic (179/0 to 176+3). Fixed.

## R9-to-R10 fixes applied

- Coverage peak corrected to 3/5 (R4).
- Trace count corrected to 7 completed / 35.
- e2e bullet rewritten to acknowledge non-determinism (two runs documented).

The code was unanimously correct across all five R9 auditors.

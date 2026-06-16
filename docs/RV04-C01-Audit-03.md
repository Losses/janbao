# RV04-C01-Audit-03: DV04 Cycle 1 — Round 3 Audit

**Date:** 2026-06-16
**Cycle:** C01 — Authentication & Entry
**Method:** 5 independent sub-agents re-audited the C01 scope after Round 1 + Round 2 fixes, each performing the full un-roled audit. Reports consolidated below.

**Round 3 Verdicts:** **0× PASS**; 1× PASS_WITH_NOTES (Agent 4), 4× FAIL (Agents 1, 2, 3, 5). All 13 Round-1 fixes + 3 of 4 Round-2 fixes CONFIRMED; **no code regressions** in the Round-1 set.
**Consolidated consensus: FAIL** — two MAJOR blockers: (a) a real defect introduced by the Round-2 prune change, and (b) the verification gate red. Both fixed; Cycle re-audited in Round 4.

---

## 1. Round 3 fix verification

- All 13 Round-1 fixes: **CONFIRMED (5/5)**, no regressions.
- R2-2 (identifier length caps), R2-4 (targetUserId guard): **CONFIRMED (5/5)**.
- **R2-3 (throttle prune "across all buckets"): CONFIRMED present but INCORRECT** — Agent 3 proved it is a real bug (see C3-1).

## 2. Findings raised in Round 3

### MAJOR (fixed before Round 4)

| # | Issue | Found by | Root cause | Fix applied |
| :-- | :---- | :------- | :--------- | :----------- |
| C3-1 | **Throttle cross-bucket prune deletes live rows.** Each bucket's `epoch = floor(now/windowSec)` is on a different scale (login 60s ≈ 29.7M; forgot/reset 3600s ≈ 495K). The R2-3 "prune across ALL buckets" predicate `windowEpoch < epoch-1` used the *current* bucket's epoch, so a login-context prune satisfied the condition for every live forgot/reset row, silently wiping the email-bombing counters. | 3 (FAIL; empirical proof), corroborated by 1, 4, 5 | The cross-bucket change in R2-3. | **Reverted to per-bucket prune**: `and(eq(bucket, bucket), lt(windowEpoch, epoch-1))`. Per-bucket epoch is comparable within one bucket, so the predicate is correct. (Bounded churned-identifier growth accepted as a carry-over.) |
| C3-2 | **Verification gate red.** `bun run lint` exited 1: `DV04-C01-Journal.md` (Round-2 section edited after prettier) and `RV04-C01-Audit-02.md` (created unformatted) failed Prettier; a table cell also contained a literal `||` that breaks markdown column count. | 1, 2, 3, 4, 5 (unanimous) | Docs edited/created after the last prettier pass. | **Discipline fix**: prettier is now run on every touched doc as the final step before each re-audit. Both docs reformatted; no `||` literals in table cells. |

### MINOR (fixed before Round 4)

| # | Issue | Found by | Fix applied |
| :-- | :---- | :------- | :----------- |
| C3-3 | `register` did not cap `email` length (login/forgot got caps in R2-2; register was missed) — same unbounded-write class. | 4, 5 | Added `email.length > 254` early reject in `register`. |
| C3-4 | `reset-password` token-expiry + sentinel checks ran outside the consume tx; the in-tx claim only conditioned on `id`. Micro-race where a token expiring mid-flight could still be consumed. | 2, 5 | Claim `DELETE` now also requires `expiresAt > now`, making single-use + expiry atomic. |

### Carry-overs (confirmed acceptable; not re-fixed)

The Round-2 carry-over set (R2-co1..co5) stands. New this round: per-bucket prune leaves rows for churned identifiers (bounded: distinct-identifiers × 2 epochs, naturally turned over) — accepted, documented.

---

## 3. Round 3 Conclusion

Round 3 caught a genuine regression that the Round-2 change itself introduced (C3-1) — exactly the adversarial signal the 5-agent loop is meant to surface — plus a process lapse (C3-2, the gate). Both MAJORs are fixed; C3-3/C3-4 are minor hardening also fixed. **Proceeding to Round 4 re-audit.**

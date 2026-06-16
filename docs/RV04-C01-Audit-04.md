# RV04-C01-Audit-04: DV04 Cycle 1 - Round 4 Audit

**Date:** 2026-06-16
**Cycle:** C01 - Authentication & Entry
**Method:** 5 independent sub-agents re-audited the C01 scope after Rounds 1–3 fixes, each performing the full un-roled audit. Reports consolidated below.

**Round 4 Verdicts:** **4× PASS** (Agents 1, 2, 3, 4 - unconditional), **1× PASS_WITH_NOTES** (Agent 5). All Round-1/2/3 fixes CONFIRMED; the C3-1 per-bucket prune verified correct; the verification gate green (each agent re-ran `bun run check` 0/0 and `bun run lint` exit 0).
**Consolidated consensus: not yet unanimous PASS** - one actionable LOW from Agent 5 (parity with C3-4). Fixed; Cycle re-audited in Round 5.

---

## 1. Round 4 fix verification

- All 13 Round-1 fixes, R2-2, R2-4, C3-1, C3-2, C3-3, C3-4: **CONFIRMED (5/5)**. The C3-1 per-bucket prune is now correct (epoch comparable within one bucket; `eq(bucket)` scoping prevents cross-bucket wipes). The C3-4 `expiresAt > now` claim predicate is in place. No regressions.
- Gate status: **GREEN** - every agent independently confirmed `bun run check` 0/0 and `bun run lint` exit 0.

## 2. Findings raised in Round 4

### Actionable (fixed before Round 5)

- **C4-1 (LOW, Agent 5):** `register`'s in-tx invitation consume conditioned only on `usedById IS NULL`; it did **not** re-check `expiresAt > now`. An invitation could expire in the ~100 ms gap (during `hashPassword`) between the pre-tx validity check and the in-tx claim and still create a user - the exact race class C3-4 closed for password-reset. Bounded (sub-second window, no auth bypass, no privilege escalation). **Fix:** the invitation claim `UPDATE … WHERE` now also requires `gte(expiresAt, now)`, making single-use + expiry atomic (parity with reset-password C3-4).

### Non-actionable (advisory, accepted / out of scope)

- **Agent 1** flagged an `appendJoinedMember` TOCTOU: the "exactly one isJoined activity per day" invariant is enforced only by a SELECT-then-INSERT inside the register tx with no DB uniqueness constraint, so two concurrent same-day registrations could insert duplicate "joined" rollups. **Cosmetic/perf only; lives on the activities surface - deferred to C05 (activities) / C02.** Not a C01 blocker.

## 3. Round 4 Conclusion

Four of five agents returned unconditional PASS; the gate is green; no Round-1/2/3 fix regressed. The lone holdout (Agent 5) named a single LOW that is a parity gap with an already-applied fix (C3-4). Fixed (C4-1). **Proceeding to Round 5 re-audit** to seek 5/5 unconditional PASS.

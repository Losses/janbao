# RV04-C01-Audit-05: DV04 Cycle 1 - Round 5 Audit (FINAL)

**Date:** 2026-06-16
**Cycle:** C01 - Authentication & Entry
**Method:** 5 independent sub-agents re-audited the C01 scope after Rounds 1–4 fixes, each performing the full un-roled audit. Reports consolidated below.

**Round 5 Verdicts:** **5× PASS** (unconditional) - Agents 1, 2, 3, 4, 5. All Round-1/2/3/4 fixes CONFIRMED; the C4-1 register expiry-in-claim fix verified correct; no regressions; no new actionable defects.
**Consolidated consensus: UNANIMOUS PASS. Audit loop closed.**

---

## 1. Final fix verification (all 5 agents)

- All 13 Round-1 fixes, R2-1..R2-4, C3-1..C3-4, and **C4-1** (register invitation claim now requires `gte(expiresAt, now)`, parity with reset-password's expiry-in-claim): **CONFIRMED (5/5)**.
- **Verification gate GREEN** - every agent independently re-ran `bun run check` (0 errors / 0 warnings) and `bun run lint` (exit 0). similarity-ts reports only the 20 informational type-pair overlaps (pre-existing, cross-cycle); zero type-duplicates.
- No regressions introduced by any round's fixes.

## 2. Findings raised in Round 5

**None actionable.** All five agents returned unconditional PASS. Minor non-actionable observations recorded by individual agents (all already covered by the documented carry-over set, not re-reported):

- A sub-millisecond boundary-tie between reset-password's pre-check (`< now`) and in-tx claim (`gt(expiresAt, now)`) - both outcomes safe (Agent 3).
- Register / admin-generate-reset / invitation-request carry no throttle - each is upstream-gated (valid invitation code / `requireAdmin` / monthly in-tx quota), so not in the login/forgot/reset abuse class (Agents 4, 5).

## 3. Carry-overs (final, accepted for C01)

1. Stateless JWT cannot be revoked on logout/reset (architectural; needs a `tokenVersion` claim).
2. `verifyPassword` length-guard early-exit (theoretical; PBKDF2 dominates).
3. `seedCore` cold-start sequential inserts (perf; deferred to C07 cross-cutting).
4. Throttle fails CLOSED (table error → 500) - conscious security choice.
5. Prod D1 migration `0008` is a manual deploy step (ships via next `bun run db:generate`).
6. `getClientAddressSafe` `'unknown'` fallback - Cloudflare sets `CF-Connecting-IP`; local/misconfig only.
7. `forgot-password` not timing-equalized (M1 scoped to login; SMTP variance dominates).
8. Throttle within-window count growth + per-bucket prune leaves churned-identifier rows (bounded, epoch-GC'd).
9. `appendJoinedMember` per-day-rollup TOCTOU (no DB uniqueness on the per-day isJoined activity) - cosmetic/perf; **deferred to C05** (activities surface).

## 4. Round 5 Conclusion

**DV04 Cycle 1 (Authentication & Entry) is unanimously considered complete and clean.** All five agents rendered an unconditional PASS; the verification gate is green; all actionable findings across Rounds 1–4 were fixed and re-verified. The nine carry-overs are documented with rationale and are not re-litigated. **C01 advances. Audit loop closed.**

---

## Appendix: C01 fix summary (Rounds 1–4)

- **Round 1 (13):** sentinel block in login/forgot/reset; login timing equalization (dummy PBKDF2); D1 throttle on login/forgot/reset; invitation conditional in-tx consume; reset-password atomic conditional DELETE-RETURNING in tx; invitation monthly-limit in tx; `getJwtSecret` fail-closed in prod; case-insensitive identity (`lower()` lookups + lowercased email write + DB `lower()` unique indexes, migration `0008`); `auth.usernameOrEmailExists` key; password min 8; `displayName` ≤ 64 + `escapeHtml` in reset email; login drops `userId`; logout cookie flags aligned.
- **Round 2 (4):** journal prettier (gate); identifier caps (login ≤ 320, forgot ≤ 254); throttle prune; admin-generate-reset `targetUserId` `typeof !== 'number'`.
- **Round 3 (4):** throttle prune reverted to per-bucket (fixed a cross-bucket wipe regression); lint-gate process fix; register email ≤ 254; reset-password claim requires `expiresAt > now`.
- **Round 4 (1):** register invitation claim requires `gte(expiresAt, now)` (expiry-in-claim parity with reset-password).

New infrastructure: `src/lib/server/throttle.ts`, `src/lib/utils/escape.ts`, migration `drizzle/local-migrations/0008_mushy_jack_power.sql` (`authThrottle` table + `users_{username,email}_lower_unique` expression indexes).

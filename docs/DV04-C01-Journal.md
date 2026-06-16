# DV04-C01-Journal: Cycle 1 Audit Journal - Authentication & Entry

## Cycle 1: Authentication & Entry

**Date:** 2026-06-16
**Status:** Audit in progress (Round 1 fixed; Round 2 pending)

---

## 1. Scope

All identity, session, registration, password-reset, and invitation surfaces:

- `/entry/{signin,signout,register,forgot,reset-password}/*`
- `/api/auth/{login,logout,register,forgot-password,reset-password,admin-generate-reset}/+server.ts`
- `/api/invitations/{+server,request}/+server.ts` (generation + monthly limit)
- Auth primitives: `src/lib/server/auth.ts` (JWT, PBKDF2), `src/hooks.server.ts`, `src/lib/server/constants.ts` (`getJwtSecret`, sentinels), `src/lib/server/db/dao/invitations.ts`, `src/lib/server/mailer.ts`
- Tables: `users`, `invitations`, `passwordRecoveries`

---

## 2. Method

Per DV04-Plan §2: each round, **5 independent sub-agents run the same full un-roled audit** (no role assignment). Reports consolidate into `RV04-C01-Audit-[round].md`. A Cycle advances only on 5/5 unconditional PASS.

---

## 3. Audit Round 1 - 2026-06-16

**Method:** 5 agents, full audit, independent contexts. Consolidated → [RV04-C01-Audit-01.md](./RV04-C01-Audit-01.md).

**Round 1 Verdicts:** 1× FAIL (Agent 4 - escalated one issue to CRITICAL), 4× PASS_WITH_NOTES. **Consensus: FAIL.**

**Severity calibration:** Agent 4's CRITICAL (system sentinel in user-auth flows) was verified against the code. The takeover is **not directly exploitable today** (reset token emailed to an undeliverable `.local` address, never returned in the response), so it was calibrated to **MAJOR (latent)** and fixed as a parity/defense-in-depth hardening - see the report for the full rationale.

**Issues found & fixed:**

| Sev   | Issue                                                                                                        | Fix                                                                                                                                                                     |
| :---- | :----------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MAJOR | System sentinel participates in `forgot-password`/`reset-password`/`login` (no `groupSlug==='system'` guard) | Mirrored the `admin-generate-reset` sentinel guard: block `system` in all three flows.                                                                                  |
| MAJOR | Login timing oracle (user-not-found returns instantly; wrong-password runs PBKDF2)                           | Precomputed dummy PBKDF2 hash; every failure path (unknown user / sentinel / wrong password) runs a real derivation.                                                    |
| MAJOR | No rate limiting anywhere on the auth surface                                                                | New `authThrottle` table (migration `0008`) + `enforceThrottle` helper (D1/libsql fixed-window, shared across isolates); per-IP + per-identifier on login/forgot/reset. |
| MAJOR | Invitation single-use TOCTOU race (in-tx consume unconditional)                                              | Conditional consume `WHERE code=? AND usedById IS NULL` + `.returning()`; abort + rollback if 0 rows.                                                                   |
| MAJOR | Reset-password consume non-atomic                                                                            | Atomic conditional `DELETE … RETURNING` claims the token inside a transaction; only one racing request succeeds.                                                        |
| MAJOR | Invitation monthly-limit race                                                                                | Count-check + insert wrapped in one transaction.                                                                                                                        |
| MAJOR | Insecure JWT-secret fallback, no production guard                                                            | `getJwtSecret` fails closed (throws) in production builds (`import.meta.env.DEV` false); fallback kept only in dev.                                                     |
| MAJOR | Case-sensitive identity columns (`Alice` ≠ `alice`)                                                          | `lower()` lookups; email lower-cased on write; DB-level `lower()` unique indexes (`0008`) close the concurrent-case race.                                               |
| MINOR | Register duplicate used wrong i18n key `discussion.alreadyExists`                                            | Switched to `auth.usernameOrEmailExists`.                                                                                                                               |
| MINOR | Weak password floor (≥5)                                                                                     | Raised to ≥8 in `register`, `reset-password`, and entry UI; updated i18n message.                                                                                       |
| MINOR | `displayName` unbounded + unescaped in reset-email HTML                                                      | `displayName` length cap (≤64); `escapeHtml` on `displayName`/`siteName` in email body.                                                                                 |
| MINOR | Login response leaked `userId`                                                                               | Dropped from the response (unused by the signin page).                                                                                                                  |
| MINOR | Logout cookie delete flags inconsistent                                                                      | Aligned `secure`/`sameSite` with the set path.                                                                                                                          |

**New files:** `src/lib/server/throttle.ts`, `src/lib/utils/escape.ts`, migration `drizzle/local-migrations/0008_mushy_jack_power.sql`.

**Carry-overs (documented, not fixed in C01):** stateless-JWT non-revocation on reset/logout (architectural; needs `tokenVersion` claim), `verifyPassword` length-guard timing (theoretical), `seedCore` cold-start batching (perf; deferred to C07).

**Verification after fixes:**

- `bun run check` → **0 errors, 0 warnings**
- `bun run lint` (prettier → eslint → similarity-ts) → **exit 0** (20 informational type-pairs, unchanged baseline)
- Runtime smoke test of `enforceThrottle`: 12 attempts / limit 10 → 2 blocked; per-identifier isolation correct; `retryAfter` correct; throwaway rows cleaned.

**Status:** Round 1 fixes applied and verified. Proceeding to Round 2 re-audit.

---

## 4. Audit Round 2 - 2026-06-16

**Method:** 5 agents re-audited the post-Round-1 C01 scope (full, un-roled). Consolidated → [RV04-C01-Audit-02.md](./RV04-C01-Audit-02.md).

**Round 2 Verdicts:** 1× PASS (Agent 2, unconditional), 4× PASS_WITH_NOTES. All 13 Round-1 fixes CONFIRMED-FIXED (5/5); **no regressions**. Not yet unanimous PASS.

**Issues found & fixed (Round 3 fixes):**

| Sev   | Issue                                                                                                | Fix                                                                     |
| :---- | :--------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- | --- | ----------------------- |
| MINOR | `DV04-C01-Journal.md` failed Prettier → lint gate red                                                | `prettier --write` on the journal.                                      |
| MINOR | `usernameOrEmail`/`email` not capped before throttle identifier use (unbounded write surface)        | Capped at 320 (login) / 254 (forgot) before the throttle call.          |
| MINOR | Throttle prune ran every call, scoped to current bucket (hot-path cost + churned-identifier leakage) | Prune now ~10% of calls (`Math.random() < 0.1`) and across all buckets. |
| LOW   | `admin-generate-reset` `targetUserId` guard `Number.isNaN(Number(x))` let `Number("")===0` through   | Tightened to `typeof targetUserId !== 'number'                          |     | !Number.isFinite(...)`. |

**Carry-overs confirmed acceptable:** throttle fail-closed availability (security choice); prod D1 migration is a manual deploy step (`0008` ships via next `bun run db:generate`); `getClientAddressSafe` `'unknown'` fallback is CF-safe; `forgot-password` SMTP-timing not equalized (scoped to login); throttle within-window count growth (bounded, epoch-GC'd).

**Verification after Round 3 fixes:** `bun run check` → 0/0; `bun run lint` → exit 0.

**Status:** Round 3 fixes applied and verified. Proceeding to Round 3 re-audit to seek 5/5 unconditional PASS.

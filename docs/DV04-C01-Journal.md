# DV04-C01-Journal: Cycle 1 Audit Journal - Authentication & Entry

## Cycle 1: Authentication & Entry

**Date:** 2026-06-16
**Status:** ✅ CLOSED - 5/5 unconditional PASS (Round 5)

---

## 1. Scope

All identity, session, registration, password-reset, and invitation surfaces:

- `/entry/{signin,signout,register,forgot,reset-password}/*`
- `/api/auth/{login,logout,register,forgot-password,reset-password,admin-generate-reset}/+server.ts`
- `/api/invitations/{+server,request}/+server.ts` (generation + monthly limit)
- Auth primitives: `src/lib/server/auth.ts` (JWT, PBKDF2), `src/hooks.server.ts`, `src/lib/server/constants.ts` (`getJwtSecret`, sentinels), `src/lib/server/db/dao/invitations.ts`, `src/lib/server/mailer.ts`, `src/lib/server/throttle.ts`
- Tables: `users`, `invitations`, `passwordRecoveries`, `authThrottle`

---

## 2. Method

Per DV04-Plan §2: each round, **5 independent sub-agents run the same full un-roled audit** (no role assignment). Reports consolidate into `RV04-C01-Audit-[round].md`. A Cycle advances only on 5/5 unconditional PASS.

---

## 3. Audit Round 1 - 2026-06-16

Consolidated → [RV04-C01-Audit-01.md](./RV04-C01-Audit-01.md).
**Verdicts:** 1× FAIL (Agent 4 escalated one issue to CRITICAL), 4× PASS_WITH_NOTES. **Consensus: FAIL.**
**Severity calibration:** the lone CRITICAL (system sentinel in user-auth flows) was verified against the code; not directly exploitable today, so calibrated to **MAJOR (latent)** and fixed as parity/defense-in-depth.

**Issues found and fixed:**

- **MAJOR** - System sentinel participates in forgot/reset/login (no `groupSlug === 'system'` guard). Mirrored the admin-generate-reset sentinel guard across all three flows.
- **MAJOR** - Login timing oracle (user-not-found returns instantly; wrong-password runs PBKDF2). Precomputed dummy PBKDF2 hash; every failure path runs a real derivation.
- **MAJOR** - No rate limiting anywhere on the auth surface. New `authThrottle` table (migration `0008`) plus `enforceThrottle` helper (D1/libsql fixed-window, shared across isolates); per-IP plus per-identifier on login/forgot/reset.
- **MAJOR** - Invitation single-use TOCTOU race (in-tx consume unconditional). Conditional consume `WHERE code = ? AND usedById IS NULL` plus `.returning()`; abort + rollback if 0 rows.
- **MAJOR** - Reset-password consume non-atomic. Atomic conditional `DELETE ... RETURNING` claims the token inside a transaction; only one racing request succeeds.
- **MAJOR** - Invitation monthly-limit race. Count-check + insert wrapped in one transaction.
- **MAJOR** - Insecure JWT-secret fallback, no production guard. `getJwtSecret` fails closed (throws) in production builds (`import.meta.env.DEV` false); fallback kept only in dev.
- **MAJOR** - Case-sensitive identity columns (`Alice` differs from `alice`). `lower()` lookups; email lower-cased on write; DB-level `lower()` unique indexes (`0008`) close the concurrent-case race.
- **MINOR** - Register duplicate used wrong i18n key `discussion.alreadyExists`. Switched to `auth.usernameOrEmailExists`.
- **MINOR** - Weak password floor (>=5). Raised to >=8 in register, reset-password, and entry UI; updated i18n message.
- **MINOR** - `displayName` unbounded + unescaped in reset-email HTML. `displayName` length cap (<=64); `escapeHtml` on displayName/siteName in email body.
- **MINOR** - Login response leaked `userId`. Dropped from the response (unused by the signin page).
- **MINOR** - Logout cookie delete flags inconsistent. Aligned `secure`/`sameSite` with the set path.

**New files:** `src/lib/server/throttle.ts`, `src/lib/utils/escape.ts`, migration `drizzle/local-migrations/0008_mushy_jack_power.sql`.

**Verification:** `bun run check` 0/0; `bun run lint` exit 0.

---

## 4. Audit Round 2 - 2026-06-16

Consolidated → [RV04-C01-Audit-02.md](./RV04-C01-Audit-02.md).
**Verdicts:** 1× PASS (Agent 2), 4× PASS_WITH_NOTES. All 13 Round-1 fixes CONFIRMED (5/5); no regressions. Not yet unanimous.

**Issues found and fixed (Round 3 fixes):**

- **MINOR** - `DV04-C01-Journal.md` failed Prettier, so the lint gate was red. Reformatted the journal.
- **MINOR** - `usernameOrEmail`/`email` not capped before throttle identifier use (unbounded write surface). Capped at 320 (login) / 254 (forgot) before the throttle call.
- **MINOR** - Throttle prune ran every call and was scoped to the current bucket (hot-path cost + stale-row leakage). Prune now ~10% of calls and across all buckets. _(This change was itself buggy - see Round 3.)_
- **LOW** - `admin-generate-reset` `targetUserId` guard let `Number("") === 0` through. Tightened to a `typeof !== 'number'` plus `Number.isFinite` check.

**Carry-overs confirmed acceptable:** throttle fail-closed availability (security choice); prod D1 migration is a manual deploy step; `getClientAddressSafe` `'unknown'` fallback is CF-safe; forgot-password SMTP-timing not equalized (M1 scoped to login); throttle within-window count growth (bounded).

---

## 5. Audit Round 3 - 2026-06-16

Consolidated → [RV04-C01-Audit-03.md](./RV04-C01-Audit-03.md).
**Verdicts:** 0× PASS; 1× PASS_WITH_NOTES, 4× FAIL. All Round-1 fixes + R2-2/R2-4 CONFIRMED; **no Round-1 regressions**. Consensus: FAIL.

Round 3 caught a genuine regression introduced by the Round-2 prune change, plus a process lapse:

**Issues found and fixed (Round 4 fixes):**

- **MAJOR** - Throttle cross-bucket prune deleted live rows: each bucket's `epoch = floor(now/windowSec)` is on a different scale, so a login-context prune wiped live forgot/reset counters (Agent 3, empirical proof). Reverted to **per-bucket prune** scoped with `and(eq(bucket), lt(windowEpoch, epoch-1))`; epoch is only comparable within one bucket. Bounded churned-identifier growth accepted as a carry-over.
- **MAJOR** - Verification gate red again: journal edited after prettier and Audit-02 created unformatted; an audit-report table cell also contained a pipe character that broke markdown column count (5/5 flagged). Process fix: prettier is now run on every touched doc as the final step before each re-audit, and no pipe characters are placed inside table cells.
- **MINOR** - `register` did not cap `email` length (login/forgot capped in R2-2; register missed) - same unbounded-write class. Added an `email.length > 254` early reject in register.
- **MINOR** - `reset-password` expiry check ran outside the consume tx; the in-tx claim only conditioned on `id` (mid-flight-expiry micro-race). Claim `DELETE` now also requires `expiresAt > now`, making single-use + expiry atomic.

**Verification after Round 4 fixes:** `bun run check` 0/0; `bun run lint` exit 0.

**Status:** Round 4 fixes applied and verified. Proceeding to Round 4 re-audit to seek 5/5 unconditional PASS.

---

## 6. Audit Round 4 - 2026-06-16

Consolidated → [RV04-C01-Audit-04.md](./RV04-C01-Audit-04.md).
**Verdicts:** 4× PASS (Agents 1, 2, 3, 4 unconditional), 1× PASS_WITH_NOTES (Agent 5). All Round-1/2/3 fixes CONFIRMED; C3-1 per-bucket prune verified correct; gate green (each agent re-ran it). Not yet 5/5.

**Issue found and fixed (Round 5 fix):**

- **LOW** - `register`'s in-tx invitation consume conditioned only on `usedById IS NULL`; it did not re-check `expiresAt > now`, so an invitation could expire in the ~100 ms `hashPassword` gap and still create a user - the same race class C3-4 closed for password-reset (Agent 5). Fix: the invitation claim `UPDATE … WHERE` now also requires `gte(expiresAt, now)`, making single-use + expiry atomic (parity with reset-password).

**Non-actionable (deferred):** Agent 1's `appendJoinedMember` daily-rollup TOCTOU (no DB uniqueness on the per-day isJoined activity) - cosmetic/perf only, lives on the activities surface; deferred to C05.

**Verification after Round 5 fix:** `bun run check` 0/0; `bun run lint` exit 0.

**Status:** Round 5 fix applied and verified. Proceeding to Round 5 re-audit to seek 5/5 unconditional PASS.

---

## 7. Audit Round 5 - 2026-06-16 (FINAL)

Consolidated → [RV04-C01-Audit-05.md](./RV04-C01-Audit-05.md).
**Verdicts:** 5× PASS (Agents 1, 2, 3, 4, 5 - all unconditional). C4-1 verified correct; all R1–R4 fixes CONFIRMED; no regressions; no new actionable defects. Each agent independently re-ran the gate (`bun run check` 0/0, `bun run lint` exit 0).

**Status: ✅ UNANIMOUS PASS - C01 audit loop closed.** All five agents consider Cycle 1 (Authentication & Entry) complete and clean for its scope.

### Carry-overs carried forward (final)

1. Stateless JWT non-revocation on logout/reset (architectural).
2. `verifyPassword` length-guard early-exit (theoretical).
3. `seedCore` cold-start cost (perf → C07).
4. Throttle fail-closed availability (security choice).
5. Prod D1 migration `0008` is a manual deploy step.
6. `getClientAddressSafe` `'unknown'` fallback (CF-safe).
7. `forgot-password` not timing-equalized (SMTP variance).
8. Throttle within-window count growth + per-bucket prune churn (bounded).
9. `appendJoinedMember` per-day-rollup TOCTOU → **deferred to C05** (activities).

**Cycle 1 complete. Advancing to Cycle 2 (Discussion Core).**

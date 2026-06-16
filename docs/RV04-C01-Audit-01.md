# RV04-C01-Audit-01: DV04 Cycle 1 - Round 1 Audit

**Date:** 2026-06-16
**Cycle:** C01 - Authentication & Entry
**Method:** 5 independent sub-agents, each performing the **full un-roled audit** (security, authorization, input validation, auth/session, soft-delete, pagination, i18n, types/lint, correctness, perf, a11y) of the C01 scope. No roles assigned. Reports consolidated and cross-referenced below.

**Round 1 Verdicts:** 1× **FAIL** (Agent 4 - escalated one issue to CRITICAL), 4× **PASS_WITH_NOTES** (Agents 1, 2, 3, 5). All five withhold unconditional PASS.
**Consolidated consensus: FAIL** - several real MAJOR defects plus one CRITICAL-calibrated finding must be fixed before PASS.

---

## 1. Severity calibration - the lone "CRITICAL"

Agent 4 rated **C1 (system-sentinel in user-auth flows)** as CRITICAL; the other four did not flag it. The DV03 precedent (one agent escalating a CRITICAL the others missed) warranted direct verification, so the code was read before accepting the rating.

**Finding is REAL; severity calibrated MAJOR (latent), not CRITICAL.** Verified facts:

- `src/lib/server/db/seed-baseline.ts:49-61` seeds the system sentinel `id=-1, username='system', email='system@janbao.local', passwordHash='SYSTEM_NO_PASSWORD', groupSlug='system', isStealth:true`.
- `forgot-password` (`+server.ts:21`) looks up by email with **no** `groupSlug` filter; `reset-password` (`:45`) sets a real PBKDF2 hash on `recovery.userId` with **no** sentinel check; `login` (`:21-25`) authenticates by username/email with **no** sentinel check. So the sentinel participates in all three flows - an inconsistency, since `admin-generate-reset` (DV03 C1) **does** block `system`/`admin`.
- **However**, the takeover is **not directly exploitable today**: the reset token is emailed to `system@janbao.local` (a `.local` domain the attacker does not control and that is not deliverable) and is **never returned in the HTTP response** (`forgot-password` returns `{success:true}`). The attacker cannot obtain the token, so cannot complete `reset-password`, so cannot install a hash, so cannot `login`. The sentinel's `SYSTEM_NO_PASSWORD` is rejected by `verifyPassword` until a real hash is installed.

Calibration rationale: not exploitable now → not CRITICAL. But it is a genuine defense-in-depth gap and a parity inconsistency with `admin-generate-reset`; any future change that surfaces a reset token (admin UI, mailer log, real mailbox) turns it into a live takeover. **Fix it (mirror the sentinel guard across the three flows).** Recorded as MAJOR.

---

## 2. Findings (deduplicated, with finders)

### MAJOR

| #      | Issue                                                                                                                                                                                                                                                                  | Location                                                                                    | Found by                      | Fix                                                                                                                                  |
| :----- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :---------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | System sentinel participates in `forgot-password` / `reset-password` / `login` (no `groupSlug==='system'` filter) - parity gap with `admin-generate-reset`; latent takeover.                                                                                           | `api/auth/{forgot-password,reset-password,login}/+server.ts`; seed `seed-baseline.ts:49-61` | 4 (CRITICAL→calibrated MAJOR) | Mirror sentinel guard: block `system` in all three flows.                                                                            |
| **M1** | **Login timing oracle** - user-not-found returns immediately; user-found-but-wrong-password runs PBKDF2 (~tens of ms). Username/email enumerable by latency despite identical `invalidCredentials`. Inconsistent with `forgot-password`'s deliberate anti-enumeration. | `api/auth/login/+server.ts:27-37`                                                           | 1,2,3,4,5 (unanimous)         | Run a dummy `verifyPassword` (precomputed PBKDF2 hash) on the not-found path so both branches take comparable time.                  |
| **M2** | **No rate limiting / throttle anywhere** on auth surface - online brute-force on `login`; email-bomb / token-flood on `forgot-password`; cost-free guessing on `reset-password`.                                                                                       | `api/auth/*`, `hooks.server.ts`                                                             | 1,2,3,4,5 (unanimous)         | D1/libsql-backed fixed-window throttle (shared across isolates); apply per-IP + per-identifier to login/forgot/reset.                |
| **M3** | **Invitation single-use TOCTOU race** - validity check is outside the tx; in-tx consume is an unconditional `UPDATE … WHERE code=?` (no `AND usedById IS NULL`). Two concurrent registrations can both consume one code.                                               | `api/auth/register/+server.ts:42-61, 102-105`                                               | 3,4                           | Conditional consume inside the tx: `… WHERE code=? AND usedById IS NULL`; abort if 0 rows.                                           |
| **M4** | **Reset-password consume non-atomic** - select → update password → delete token are separate statements; two racing requests can both consume one token.                                                                                                               | `api/auth/reset-password/+server.ts:23-51`                                                  | 2(m),3(m),4(M)                | Wrap consume in `db.transaction`.                                                                                                    |
| **M5** | **Invitation monthly-limit race** - count read outside tx, insert after; parallel requests can exceed `MONTHLY_INVITATION_LIMIT`.                                                                                                                                      | `api/invitations/request/+server.ts:41-68`                                                  | 3                             | Wrap count-check + insert in `db.transaction`.                                                                                       |
| **M6** | **Insecure JWT-secret fallback, no production guard** - `getJwtSecret` returns a hard-coded public secret with only `console.warn` when `JWT_SECRET` unset; a misconfigured prod deploy silently runs forgeable.                                                       | `src/lib/server/constants.ts:5-16`                                                          | 1(m),2(M),3(m)                | Fail-closed (throw) when secret absent in a production build (`import.meta.env.DEV` false); keep fallback only in dev.               |
| **M7** | **Case-sensitive identity columns** - `users.username`/`email` are BINARY-collation `unique()`. `Alice` ≠ `alice`; near-duplicate registrations & impersonation confusion; email is RFC-case-insensitive.                                                              | `db/schema.ts:21-22`; login/register/forgot lookups                                         | 1                             | Case-insensitive lookups (`lower()`); lowercase email on write; DB-level `lower()` unique indexes to close the concurrent-case race. |

### MINOR / NITS

| #      | Issue                                                                                                                     | Location                                                              | Found by | Fix                                                                                      |
| :----- | :------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------- | :------- | :--------------------------------------------------------------------------------------- |
| **m1** | Register duplicate error uses wrong i18n key `discussion.alreadyExists` instead of existing `auth.usernameOrEmailExists`. | `api/auth/register/+server.ts:119`                                    | 2,3,4    | Use `auth.usernameOrEmailExists`.                                                        |
| **m2** | Weak password floor (≥5 chars); UI hint reinforces it.                                                                    | `api/auth/{register,reset-password}/+server.ts:34,19`; entry UI       | 1,5      | Raise to ≥8; update i18n message + UI hint.                                              |
| **m3** | `displayName` not length-validated; interpolated **unescaped** into reset-email HTML body (XSS-in-email / injection).     | `api/auth/register/+server.ts:22`; `forgot-password/+server.ts:47-57` | 4        | Validate `displayName` length (≤64); HTML-escape `displayName`/`siteName` in email body. |
| **m4** | Login response returns `userId` to the (now-authenticated) caller; unused by the signin page.                             | `api/auth/login/+server.ts:63`                                        | 5        | Drop `userId` from the response.                                                         |
| **m5** | Logout cookie delete omits `secure`/`sameSite` flags used on set (cosmetic inconsistency).                                | `api/auth/logout/+server.ts:7`                                        | 3        | Align delete flags with the set path.                                                    |

### Carry-overs (documented architectural limitations; not fixed in C01)

| #   | Item                                                                                                            | Rationale                                                                                                                                                      |
| :-- | :-------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| co1 | Stateless JWT cannot be revoked on logout / password reset (no sessions table; stolen token valid until `exp`). | Accepted architecture (DV04-Plan §5). Full fix needs a `tokenVersion`/`passwordChangedAt` claim + schema + hooks check - out of C01 scope. Found by 1,2,3,4,5. |
| co2 | `verifyPassword` length-guard early-exit before the constant-time loop (theoretical; PBKDF2 dominates).         | Negligible; keep on file. Found by 1.                                                                                                                          |
| co3 | `seedCore` cold-start issues 5 sequential group inserts per isolate.                                            | Perf only; defer to C07 (cross-cutting). Found by 4,5.                                                                                                         |

---

## 3. Consensus POSITIVE observations

- **JWT primitives sound** - HS256 enforced via HMAC key import + `crypto.subtle.verify('HMAC', …)`; no algorithm-confusion path (attacker `alg` never trusted); `exp` enforced post-verify. (all 5)
- **PBKDF2-SHA256 100k, 16-byte per-hash salt; iteration parsed from stored envelope; constant-time compare.** (all 5)
- **Reset tokens** are `crypto.randomUUID()` (122 bits), single-use (deleted on consume), 48h expiry enforced, expired tokens GC'd. (all 5)
- **Invitation codes** use `crypto.getRandomValues` over an unambiguous 30-symbol alphabet (~5.3×10¹⁷ space); monthly limit enforced server-side, admins bypass. (all 5)
- **`admin-generate-reset` sentinel/super-admin guard intact and server-authoritative** - DV03 closed items NOT regressed. (all 5)
- **Forgot-password is body-enumeration-safe** (always `{success:true}`; email sent only to the DB address). (1,2,3,4) - the timing angle is M2/F1.
- **Register transaction** wraps uniqueness check + user insert + notification-preferences + invitation link + joined-activity. (all 5)
- **Cookie flags correct** on set: `httpOnly`, `sameSite:'strict'`, `secure` from protocol, `path:'/'`. (all 5)
- **i18n parity exact** between `en.json`/`zh-CN.json` (all keys, both directions); `{email}`/`{link}` interpolation matches. (all 5)
- **Types/lint clean in scope** - named interfaces for all bodies; no `as any`/`as unknown as`; component props via `PageProps`. (all 5)
- **`system` sentinel cannot authenticate today** - `SYSTEM_NO_PASSWORD` is malformed, rejected by `verifyPassword` before any PBKDF2 work. (5)

---

## 4. Round 1 Action Plan

Fix in priority order: **C1** (sentinel guard) → **M1** (login timing) → **M2** (rate limiting) → **M3/M4/M5** (race/atomicity) → **M6** (JWT secret) → **M7** (case-insensitivity) → minors m1–m5. Run `bun run check` + `bun run lint`. Then re-audit (Round 2) seeking 5/5 unconditional PASS.

# RV00-C01-Audit-01: Cycle 1 Round 1 Audit Report

**Date:** 2026-06-12
**Auditors:** 5 Independent SubAgents
**Scope:** Cycle 1 - Foundations, Schemas, Core Seed & Authentication

---

## 1. Audit Summary

| Agent   | Focus Area                                       | Verdict |
| ------- | ------------------------------------------------ | ------- |
| Agent 1 | Database Schema & Seeding                        | FAIL    |
| Agent 2 | Authentication, Cryptography & Security          | FAIL    |
| Agent 3 | i18n System, Hooks Middleware & Type Definitions | FAIL    |
| Agent 4 | Frontend Views, Layout Templates & Entry Routes  | FAIL    |
| Agent 5 | Project Configuration, ESLint & Code Quality     | FAIL    |

**Overall Verdict: FAIL** - 9 Critical/Major defects identified requiring code changes.

---

## 2. Critical Defects

### C1. JWT tokens issued without `exp` claim (Agent 2)

Neither register nor login endpoints set the `exp` field in the JWT payload. Tokens never expire at the cryptographic level. If a token is exfiltrated, it remains valid indefinitely.

- `src/routes/api/auth/register/+server.ts:97`
- `src/routes/api/auth/login/+server.ts:38-40`

**Fix:** Add `exp` claim (30 days for rememberMe, 24 hours otherwise).

### C2. JWT_SECRET fallback silently allows authentication bypass (Agent 2, 5)

The hardcoded fallback `'fallback-secret-key-for-local-dev-only'` is duplicated in 3 files. If `JWT_SECRET` is misconfigured in production, the system silently uses this publicly visible string, enabling complete auth bypass.

- `src/hooks.server.ts:28`
- `src/routes/api/auth/register/+server.ts:96`
- `src/routes/api/auth/login/+server.ts:37`

**Fix:** Extract to shared constant; add console.warn when using fallback.

### C3. Missing admin user bootstrap in seed script (Agent 1, 3)

Spec Section 7.1 requires seeding an admin user from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars. The seed script only provisions groups and system user. No administrative user can be created without manual DB intervention.

- `src/lib/server/db/seed.ts`

**Fix:** Add admin user bootstrap step to seedCore.

### C4. `secure: true` on cookies breaks local HTTP development (Agent 2, 5)

Browsers silently refuse to set cookies with `Secure` flag over HTTP. This makes auth impossible to test locally without HTTPS.

- `src/routes/api/auth/register/+server.ts:104`
- `src/routes/api/auth/login/+server.ts:48`

**Fix:** Make `secure` conditional based on request protocol.

---

## 3. Major Defects

### M1. Race condition in registration uniqueness check (Agent 2)

The SELECT for existing username/email runs outside the transaction. A concurrent request could insert the same username between the SELECT and the INSERT, causing an unhandled 500 error.

- `src/routes/api/auth/register/+server.ts:49-65`

**Fix:** Move uniqueness check inside the transaction.

### M2. Registration cookie always sets maxAge: 2592000 (Agent 2)

The register endpoint hardcodes a 30-day persistent cookie without supporting session cookies.

- `src/routes/api/auth/register/+server.ts:99-106`

**Fix:** Support rememberMe parameter in registration.

### M3. Hardcoded English strings violate i18n architecture (Agent 3, 5)

Multiple frontend components contain hardcoded English strings that bypass the translation dictionary, including error messages, labels, and status indicators.

- `src/routes/+page.svelte` (4 strings)
- `src/routes/entry/signin/+page.svelte` (3 strings)
- `src/routes/entry/register/+page.svelte` (8 strings)
- `src/routes/entry/signout/+page.svelte` (2 strings)

**Fix:** Add i18n keys and replace hardcoded strings with `t.xxx` references.

### M4. Color palette violations (Agent 4)

The spec restricts the color system to 4 semantic colors (primary, neutral, accent, warning). The implementation uses `alert-error`, `text-success`, and `text-error` which fall outside this palette.

- `src/routes/entry/signin/+page.svelte:57`
- `src/routes/entry/register/+page.svelte:81,157`
- `src/routes/entry/signout/+page.svelte:54`

**Fix:** Replace `alert-error` with `alert-warning`, `text-success`/`text-error` with `text-primary`/`text-warning`.

### M5. Missing `auth.displayName` i18n key (Agent 3, 5)

The registration form's "Display Name" field uses a hardcoded string with no translation key.

- `src/routes/entry/register/+page.svelte:117`

**Fix:** Add `auth.displayName` to both en.json and zh-CN.json.

---

## 4. Minor Defects

### m1. System user seeded with predictable rssToken (Agent 1)

- `src/lib/server/db/seed.ts:71` - Uses `'system-rss-token-value'` instead of `crypto.randomUUID()`.

### m2. Journal references non-existent index names (Agent 5)

- `docs/DV00-C01-Journal.md:16` - References `unique_read_idx` and `unread_notifications_idx` which do not exist in the schema.

### m3. `resolveLang` ignores Accept-Language quality values (Agent 3)

- `src/lib/server/i18n.ts:22-25` - Does not respect `q` values in locale preferences.

### m4. Login timing attack - no dummy hash for nonexistent users (Agent 2)

- `src/routes/api/auth/login/+server.ts` - PBKDF2 only runs for existing users, creating a timing side-channel.

### m5. Unused `signoutBtn` i18n key (Agent 4)

- `src/lib/i18n/en.json:22` - Key defined but never referenced in code.

---

## 5. Deferred Items (Future Cycles)

These are spec requirements not yet implemented but outside Cycle 1 scope:

- Home page discussion list with pagination (Cycle 2+)
- Sidebar widgets: User Info Block, Category List, Active Users Wall (Cycle 2+)
- Header component with navigation (Cycle 2+)
- DaisyUI `data-theme` injection (Cycle 2+)
- Inter font configuration (Cycle 2+)
- Rate limiting on login attempts (Cycle 2+)

---

## 6. Resolution Plan

| ID  | Fix Description                                   | Files Changed                                        |
| --- | ------------------------------------------------- | ---------------------------------------------------- |
| C1  | Add `exp` claim to JWT tokens                     | `auth.ts`, `register/+server.ts`, `login/+server.ts` |
| C2  | Extract JWT_SECRET to shared utility with warning | New `constants.ts`, 3 files updated                  |
| C3  | Add admin user bootstrap to seed script           | `seed.ts`, `app.d.ts`                                |
| C4  | Conditional `secure` cookie flag                  | `register/+server.ts`, `login/+server.ts`            |
| M1  | Move uniqueness check into transaction            | `register/+server.ts`                                |
| M2  | Support rememberMe in registration cookie         | `register/+server.ts`                                |
| M3  | Replace hardcoded strings with i18n keys          | 4 page files, 2 JSON files                           |
| M4  | Fix color palette to use only permitted colors    | 3 entry page files                                   |
| M5  | Add `auth.displayName` i18n key                   | 2 JSON files, register page                          |

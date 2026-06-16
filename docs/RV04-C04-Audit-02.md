# RV04-C04-Audit-02: DV04 Cycle 4 - Round 2 Audit (FINAL)

**Date:** 2026-06-16
**Cycle:** C04 - User Profile
**Method:** 5 independent sub-agents re-audited the C04 scope after Round 1 fixes, each performing the full un-roled audit. Reports consolidated below.

**Round 2 Verdicts:** **5× PASS** (unconditional) - Agents 1, 2, 3, 4, 5. All six Round-1 fix groups CONFIRMED; no regressions; no new actionable defects.
**Consolidated consensus: UNANIMOUS PASS. Audit loop closed.**

---

## 1. Final fix verification (all 5 agents)

- **C4-1**: `/api/profile/password` (server + svelte), register, reset-password all use centralized `MIN_PASSWORD_LENGTH` (=8). No `< 5` remains.
- **C4-2/C4-3**: `/api/profile/edit` validates email with `EMAIL_REGEX` + `MAX_EMAIL_LENGTH` (254); `displayName` capped at `MAX_DISPLAY_NAME_LENGTH` (64). register swapped to the same constants (behavior identical).
- **C4-4 (stealth)**: `hooks.server.ts` skips the `lastActiveTime` write when `safeUser.isStealth` (stored value frozen, never current); profile `+page.svelte` gates the "last active" row behind `!isStealth || isOwner || admin`. Verified the hooks guard does **not** break `/api/users/online` (it filters `isStealth=false` independently - defense-in-depth).
- **C4-5 (stealth)**: `/api/users/search` base conditions include `eq(users.isStealth, false)` in both branches.
- **C4-6**: `/api/profile/edit` lowercases email on write + `lower()` uniqueness (aligned with the `users_email_lower_unique` index; no case-variant 500); username check also `lower()`; `showEmail` `typeof === 'boolean'`-validated.
- **DV03 M1 (sub-page admin-sidebar parity + target-email leak prevention): INTACT.** No IDOR on any self-mutation; password-change verifies current password.
- **Verification gate GREEN** - every agent re-ran `bun run check` (0/0) and `bun run lint` (exit 0).

## 2. Findings raised in Round 2

**None actionable.** All five agents returned unconditional PASS. Non-actionable observations:

- **Stealth `lastActiveTime` residual in SSR page-data** (Agent 5 LOW; Agents 3, 4 intended-design): the public `targetUser` payload still serializes `lastActiveTime`, but the hooks freeze means it is a stale (pre-stealth) timestamp, not live presence; the rendered row is gated. Materially weaker than the accepted "joined today" historical-presence carry-over. Accepted.
- **C01 entry-route literals** (Agents 1, 2 informational): `entry/reset-password/+page.svelte` and `forgot-password/+server.ts` still hardcode `8`/`254` (C01 scope, value matches the centralized constants). Not a C04 regression.

## 3. Carry-overs (final, accepted for C04)

1. `showEmail` toggle stored/edited but never read on any render path (no-op feature, no leak; product decision).
2. profile-comment (wall-reply) notification only for top-level directed activities (C05 scope).
3. "who joined today" wall does not filter `isStealth` (historical signup record; judgment call).
4. `/profile/onlineNow` misleading route name (cosmetic).
5. `avatarFileId` accepted unvalidated on profile-edit (defense-in-depth; upload writes `'1'`).
6. username-change does not reserve group slugs (admin-gated, low impact).
7. redundant `as InvitationItem[]` cast; `parseDiscussionPagination` no upper page bound (cosmetic).
8. stealth `lastActiveTime` remains in the SSR page-data JSON (frozen/stale, not live; UI gated).

## 4. Round 2 Conclusion

**DV04 Cycle 4 (User Profile) is unanimously considered complete and clean.** All five agents rendered an unconditional PASS; the gate is green; the five MAJORs + one MINOR from Round 1 are fixed and re-verified; IDOR, target-email-leak prevention, current-password verification, and the stealth surface (now defended at hooks + online-wall + typeahead + profile-render) all hold. **C04 advances. Audit loop closed.**

---

## Appendix: C04 fix summary (Round 1)

- **C4-1 (MAJOR):** centralized `MIN_PASSWORD_LENGTH` (=8); profile/password (server + svelte), register, reset-password all use it.
- **C4-2/C4-3 (MAJOR):** centralized `EMAIL_REGEX` + `MAX_EMAIL_LENGTH` (254) + `MAX_DISPLAY_NAME_LENGTH` (64) in `$lib/utils/validation.ts`; profile-edit validates email format/length + displayName cap; register swapped to the same constants.
- **C4-4 (MAJOR, stealth):** `hooks.server.ts` skips the `lastActiveTime` write for stealth users (frozen); profile `+page.svelte` gates the "last active" row behind owner/admin.
- **C4-5 (MAJOR, stealth):** `/api/users/search` adds `eq(users.isStealth, false)` to both branches.
- **C4-6 (MINOR):** profile-edit email lower-cased on write + `lower()` uniqueness; username `lower()`; `showEmail` boolean-typed.

New shared constants module additions: `EMAIL_REGEX`, `MIN_PASSWORD_LENGTH`, `MAX_DISPLAY_NAME_LENGTH`, `MAX_EMAIL_LENGTH`, `MAX_BIO_LENGTH` in `$lib/utils/validation.ts`.

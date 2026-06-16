# RV04-C04-Audit-01: DV04 Cycle 4 - Round 1 Audit

**Date:** 2026-06-16
**Cycle:** C04 - User Profile
**Method:** 5 independent sub-agents, each performing the full un-roled audit of the C04 scope. No roles assigned. Reports consolidated below.

**Round 1 Verdicts:** **0× PASS**, **5× PASS_WITH_NOTES**.
**Consolidated consensus: FAIL** - five actionable MAJORs (input-validation parity + two stealth leaks) plus MINORs.

---

## 1. Findings (deduplicated, with finders)

### MAJOR

- **C4-1 (5/5 unanimous):** `src/routes/api/profile/password/+server.ts` enforces `newPassword.length < 5`, but C01 (register/reset) enforces `< 8` and the shared i18n `auth.passwordTooShort` says "at least 8 characters". A user can weaken their own password to 5–7 chars after registration - a real downgrade of the C01 policy. Fix: `< 8` (server + `password/+page.svelte`).
- **C4-2 (Agents 2, 3, 4, 5):** `src/routes/api/profile/edit/+server.ts` accepts an email with no format check and no ≤254 cap (register has `EMAIL_REGEX` + ≤254). A user can store `"x"` or a 10 KB string as their email. Fix: mirror register's validation.
- **C4-3 (Agents 1, 2, 3, 4):** `src/routes/api/profile/edit/+server.ts` caps `displayName` only at non-empty (register caps ≤64, i18n `auth.displayNameTooLong`). Unbounded display name → layout/DB hygiene. Fix: ≤64 cap.
- **C4-4 (Agent 5):** **Stealth leak via `lastActiveTime`.** `hooks.server.ts` updates `lastActiveTime` unconditionally (including stealth users), and the public profile header renders `lastActiveTime` to ANY visitor. A stealth user (who opted out of presence) has their live "last active: a few seconds ago" exposed on their profile. The plan §5 says stealth users must be hidden from activity walls. Fix: suppress `lastActiveTime` in the public profile payload when the target is stealth and the viewer is not the owner/admin.
- **C4-5 (Agent 5):** **Stealth leak via `/api/users/search`.** The empty-`q` suggestion list orders by `lastActiveTime DESC` with no `isStealth=false` filter, so stealth users appear in the @mention / PM-recipient typeahead. Fix: add `eq(users.isStealth, false)`.

### MINOR (fixed this round)

- **C4-6 (Agents 2, 3, 4):** profile-edit email is not lower-cased on write and the uniqueness check is case-sensitive, so a case-variant email passes the app check then throws a DB unique-constraint error → 500 instead of the intended 409. Fix: lowercase on write + `lower()` existence check (parity with register).

### Carry-overs (documented, accepted)

- **C4-co1 (Agents 1, 2, 5):** `showEmail` is a stored/edited toggle that is **never read** on any render path (the public profile payload omits `email` entirely). It is a no-op feature (safe - no leak). Product decision: wire it up or remove. Accepted as-is.
- **C4-co2 (Agent 1):** profile-comment (wall reply) notification is only created for top-level directed activities, not for replies on a wall post. C05-scope (activities/notifications). Accepted.
- **C4-co3 (Agent 3):** the "who joined today" wall (`activity/+page.server.ts`, profile joinedMembers) does not filter `isStealth`. It is a historical signup record, not live presence; judgment call. Accepted.
- **C4-co4:** `/profile/onlineNow` is misleadingly named (it is the stealth-settings page; the real online wall is `/api/users/online`). Cosmetic; a route rename is out of scope/risky. Accepted.
- **C4-co5 (Agent 3):** `avatarFileId` on profile-edit is accepted unvalidated; the upload route writes the constant `'1'` and avatars are served by `userId`, so the field is effectively a "has avatar" flag. Defense-in-depth. Accepted.
- **C4-co6 (Agent 5):** username-change does not reserve group slugs (`admin`/`system`/`guest`/…); admin-gated, low impact. Accepted.
- **C4-co7:** redundant `data.invitations as InvitationItem[]` cast; `parseDiscussionPagination` has no upper page bound. Cosmetic. Accepted.

---

## 2. DV03 / pre-known verification (all 5 agents)

- **DV03 M1 (sub-page admin-sidebar parity + target-email leak prevention): INTACT (5/5).** `/profile/discussions` and `/profile/comments` both call `getProfileAdminSidebarData` and forward `targetUserGroupSlug`/`targetUserEmail`/`manageableGroups` to `ProfileSidebar` identically to the main profile page; `getProfileAdminSidebarData` returns empty for non-admins; the public `targetUser` payload never includes `email`.
- **No IDOR (5/5):** all four `/api/profile/{edit,password,preferences,stealth}` handlers and all four `/profile/{…}` loads act only on `locals.user.id`; no `targetUserId` body param exists.
- **Password change verifies the current password (5/5).** Stealth correctly excluded from `/api/users/online` (but see C4-4/C4-5 for the other stealth surfaces). Soft-delete/disabled-category propagation, slug resolution (by `userId`, slug cosmetic), view-count (excludes self), and pagination all clean.

---

## 3. Round 1 Action Plan

Centralize `EMAIL_REGEX` + length constants in `$lib/utils/validation.ts`; fix **C4-1** (password `< 8`) → **C4-2/C4-3/C4-6** (profile-edit email format/cap/lowercase + displayName cap) → **C4-4** (suppress stealth `lastActiveTime` for non-owner/non-admin) → **C4-5** (`/api/users/search` `isStealth=false`). Carry over C4-co1..co7. Run `bun run check` + `bun run lint`. Then re-audit (Round 2).

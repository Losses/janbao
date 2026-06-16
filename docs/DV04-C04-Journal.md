# DV04-C04-Journal: Cycle 4 Audit Journal - User Profile

## Cycle 4: User Profile

**Date:** 2026-06-16
**Status:** Audit in progress (Round 1 fixed; Round 2 pending)

---

## 1. Scope

Profile view, self-management (edit/password/preferences/picture/stealth), profile sub-pages, and the @mention/PM typeahead:

- View: `src/routes/profile/[userId]/[userSlug]/+page.{server,svelte}`
- Self-management: `src/routes/profile/{edit,password,preferences,picture}/+page.server.ts` + `src/routes/api/profile/{edit,password,preferences,stealth}/+server.ts`
- Sub-pages: `src/routes/profile/{comments,discussions}/[userId]/[userSlug]/+page.server.ts`, `src/routes/profile/{invitations,onlineNow}/+page.svelte`
- DAO: `src/lib/server/db/dao/{comments,admin-permissions,invitations}.ts`; `src/lib/components/molecules/ProfileSidebar.svelte`
- Cross-touched: `src/routes/api/users/search/+server.ts`, `src/hooks.server.ts`, `src/lib/utils/validation.ts`, register/reset-password (constant centralization)

---

## 2. Method

Per DV04-Plan §2: 5 independent sub-agents run the same full un-roled audit; advance only on 5/5 unconditional PASS. Gate each round: `bun run check` 0/0 + `bun run lint` exit 0.

---

## 3. Audit Round 1 - 2026-06-16

Consolidated → [RV04-C04-Audit-01.md](./RV04-C04-Audit-01.md).
**Verdicts:** 0× PASS, 5× PASS_WITH_NOTES. **Consensus: FAIL.**

**Issues found and fixed (Round 2 fixes):**

- **MAJOR (5/5)** - `/api/profile/password` enforced `< 5` while C01 enforces `< 8` (and the i18n says "at least 8"); a user could weaken their own password. Fix: centralized `MIN_PASSWORD_LENGTH = 8` in `$lib/utils/validation.ts`; used in profile/password (server + svelte), register, reset-password.
- **MAJOR** - `/api/profile/edit` email had no format check / no ≤254 cap. Fix: centralized `EMAIL_REGEX` + `MAX_EMAIL_LENGTH`/`MAX_DISPLAY_NAME_LENGTH` in validation.ts; profile-edit now validates email format+length and caps displayName at 64 (register swapped to the same constants).
- **MAJOR (Agent 5)** - Stealth leak: `hooks.server.ts` updated `lastActiveTime` unconditionally and the public profile header rendered it to any visitor, exposing a stealth user's live presence. Fix: hooks now skips the `lastActiveTime` write when `safeUser.isStealth` (frozen, never "current"); the profile `+page.svelte` also gates the "last active" row behind `!isStealth || isOwner || isAdmin`.
- **MAJOR (Agent 5)** - Stealth leak: `/api/users/search` empty-`q` suggestion list ordered by `lastActiveTime` with no `isStealth=false` filter. Fix: added `eq(users.isStealth, false)` to the base conditions.
- **MINOR** - `/api/profile/edit` email not lower-cased on write + case-sensitive uniqueness check (case variants → raw 500 instead of 409). Fix: lowercase on write + `lower()` existence check; username existence check also switched to `lower()` for parity; `showEmail` now `typeof === 'boolean'`-validated.

**Carry-overs (documented, accepted):** `showEmail` toggle is never read on any render path (no-op feature, no leak — product decision); profile-comment (wall-reply) notification only for top-level directed activities (C05 scope); "who joined today" wall does not filter `isStealth` (historical signup record, judgment call); `/profile/onlineNow` misleading route name (cosmetic); `avatarFileId` accepted unvalidated (defense-in-depth, upload writes `'1'`); username-change does not reserve group slugs (admin-gated, low impact); redundant `as InvitationItem[]` cast + `parseDiscussionPagination` no upper page bound (cosmetic).

**DV03 verified intact (5/5):** DV03 M1 sub-page admin-sidebar parity + target-email leak prevention; no IDOR on any self-mutation; password-change verifies current password.

**Verification after Round 2 fixes:** `bun run check` 0/0; `bun run lint` exit 0.

**Status:** Round 2 fixes applied and verified. Proceeding to Round 2 re-audit to seek 5/5 unconditional PASS.

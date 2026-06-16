# RV03-C03-Audit-01: DV03 Cycle 3 - Round 1 Audit

**Date:** 2026-06-16
**Method:** 5 independent sub-agents performed full audits of the DV03 permission-management feature (diff `13f289f..4017ef0`). Reports consolidated below (deduped, cross-referenced). Agents ran in independent contexts; several were restarted due to transient 529 gateway errors.

**Round 1 Verdicts:** PASS_WITH_NOTES × 4, PASS_WITH_NOTES × 1 (one agent - D - escalated two issues to CRITICAL that the others rated MAJOR or missed entirely). **Consolidated consensus: FAIL (one CRITICAL privilege-escalation must be fixed before PASS).**

---

## 1. CRITICAL issues (must fix before PASS)

### C1. Peer admin can take over any admin (incl. super-admin user 0) via the reset-link endpoint

_(Found by Agent D; missed by Agents 3, 4, B, C)_

`src/routes/api/auth/admin-generate-reset/+server.ts:13` authorises only on the **caller** being admin; it never inspects the **target's** group. A peer (non-super) admin can POST `targetUserId: 0` (or any admin id) and receive a 48-hour password-reset link, then complete the reset flow and sign in as that admin - gaining super-admin powers and entirely defeating the C03 "admins cannot change an existing admin's group" rule via a different endpoint.

This is a real privilege-escalation: the group-change API is locked down, but the reset-link API is an open backdoor into any admin account.

**Fix:** After the target-exists lookup, fetch the target's `groupSlug`; reject with `permissions.adminGroupChangeForbidden` (403) when the target is an admin **and** the caller is not the super-admin (user 0). Also gate the UI "Generate Reset Link" button in `ProfileSidebar.svelte` the same way (`isAdmin && (targetUserGroupSlug !== 'admin' || user.id === 0)`).

_(Also addresses the related MINOR that this endpoint uses an inline check instead of the `requireAdmin` helper.)_

### C2. `editReply` author-bypass lets an author edit a reply inside a disabled category

_(Found by Agents 3, B, C, D; Agent D rated CRITICAL, others MAJOR)_

`src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts:~455` (`editReply` action) gates on `!perms.canUpdate && !isAuthor`. `resolvePermissions` returns all-false for a disabled category, but the `isAuthor` short-circuit lets the original author edit their reply via a direct form POST that skips the page `load` 404 guard. This violates "a disabled category is inaccessible everywhere outside the admin UI." (Note: `editDiscussion` is NOT vulnerable - its `canRead` check fires before the author bypass; `deleteReply` is also safe - it checks `canDelete` only.)

**Fix:** Add `isNull(categories.disabledAt)` to the `editReply` reply-fetch JOIN (so a disabled-category reply 404s), mirroring the read-side filter.

---

## 2. MAJOR issues

### M1. Admin controls absent on `/profile/discussions` and `/profile/comments` (and `/profile/invitations`)

_(Found by Agents 4, B, C, D - unanimous)_

`ProfileSidebar` accepts `targetUserGroupSlug`, `targetUserEmail`, `manageableGroups`, but only `/profile/[userId]/[userSlug]/+page.svelte` passes them. The discussion/comment sub-pages render `ProfileSidebar` without the props, so an admin on those pages loses the group dropdown, reset-link button, and promote-to-admin button - and the reset copy sentence would render with an empty `{email}`. Their `load` functions also do not fetch the data.

**Fix:** Fetch `manageableGroups` + `targetUserEmail` (admin-only) + target `groupSlug` in each sub-page's `+page.server.ts` (mirror `/profile/[userId]/[userSlug]/+page.server.ts:201-215`) and pass the three props through.

### M2. `targetUserId === 0` rejected by falsy guard

_(Found by Agents 3, 4, B, D)_

`src/routes/api/admin/users/group/+server.ts:33` uses `if (!targetUserId || !groupSlug)`. Since `Number(0)` is falsy, targeting user 0 returns `fieldsRequired` (400) instead of reaching the intended guards. Latent correctness bug (user 0 is the bootstrap admin the super-admin rule keys off).

**Fix:** `if (targetUserId === undefined || Number.isNaN(targetUserId) || !groupSlug)`.

### M3. System-group user not protected from peer-admin reassignment (server-side)

_(Found by Agent D cross-check, reinforced by Agent 4's m6)_

`users/group/+server.ts:44` excludes `currentGroupSlug === 'admin'` but not `'system'`. The `system` sentinel (id -1, `SYSTEM_USER_ID`) authors the isJoined activities; a peer admin could reassign it out of `system` (target value `system` is blocked by `isValidTargetGroup`, but moving _out of_ system is not).

**Fix:** Add `currentGroupSlug === 'system'` to the peer-admin exclusion set (or to `canManageTargetGroup` client-side too).

### M4. Permissions-matrix save mass-overwrites untouched rows → potential lockout

_(Found by Agent D)_

`src/routes/admin/permissions/+page.svelte` `savePermissions` sends an upsert row for **every** enabled category, defaulting missing drafts to `false`. Ticking one box and saving silently sets all other categories for that group to all-false → mass lockout.

**Fix:** Send only rows the user actually changed (track a dirty set), or only rows where the draft differs from the loaded explicit/default value.

---

## 3. MINOR / NITS (fix opportunistically)

| #   | Issue                                                                                                                                           | Location                                 | Fix                                              |
| :-- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------- | :----------------------------------------------- |
| m1  | Dead i18n keys (`profile.permissionManagement`, `permissions.addCategory`, `permissions.addGroup`) from the removed `/profile/permissions` page | `en.json` / `zh-CN.json`                 | remove                                           |
| m2  | `BOOTSTRAP_ADMIN_ID = 0` magic number; repo already exports `SYSTEM_USER_ID`/`GHOST_USER_ID`                                                    | `users/group/+server.ts`, `constants.ts` | export from constants, import                    |
| m3  | Unused export `ASSIGNABLE_RESERVED_USER_GROUP_SLUGS`                                                                                            | `admin-permissions.ts:18`                | delete or use                                    |
| m4  | `deleteGroup` has no confirmation modal (one-click delete)                                                                                      | `admin/user-groups/+page.svelte`         | add confirm modal                                |
| m5  | Permissions-matrix `$effect` can wipe in-progress edits on an unrelated `invalidateAll()`                                                       | `admin/permissions/+page.svelte:55-76`   | key draft by group; only reset on group change   |
| m6  | Empty-state missing when no manageable groups / no enabled categories                                                                           | `admin/permissions/+page.svelte`         | add `{#if ...length===0}` branches               |
| m7  | `users/group` TOCTOU between current-group read and write                                                                                       | `users/group/+server.ts`                 | wrap in `db.transaction`                         |
| m8  | `admin-generate-reset` uses inline check instead of `requireAdmin` helper (subsumed by C1 fix)                                                  | `admin-generate-reset/+server.ts`        | consolidate                                      |
| m9  | `upsertCategoryPermissions` does N sequential inserts in a transaction                                                                          | `admin-permissions.ts:160-182`           | single array `.values([...]).onConflictDoUpdate` |
| m10 | Similarity-ts type-pair count rose to 20 (Admin\* CRUD DTOs overlap 88-93%)                                                                     | `types/api.ts`                           | borderline; consider shared base interface       |

---

## 4. Consensus POSITIVE observations

- **Disabled-category read-path filtering is exhaustive** - every list/count/detail/RSS/search/bookmark/post path filters `categories.disabledAt IS NULL`. The only gaps are write-action endpoints (C2). Centralisation through `resolvePermissions` (all-false for disabled) + `getReadableCategorySlugs` is clean.
- **Super-admin / mutual-exclusion logic in `/api/admin/users/group` is correct** for its scope - bootstrap id 0, peers cannot touch admins or self, self-lockout prevented. (The escalation bypass is via the reset endpoint, C1, not this one.)
- **Email-leak prevention is correct** - `targetUserEmail` fetched admin-only in a separate query, never in the public `targetUser` payload.
- **i18n parity is exact** between `en.json` and `zh-CN.json` for all ~47 new keys including `{email}`/`{link}` interpolation.
- **Type/lint discipline holds** - named interfaces, no inline typings, `bun run check` 0 errors, eslint clean on `src/`.
- **`FormField` atom + Svelte 5 runes usage is idiomatic** - `$derived` for computed, `$state` for mutable, no `$effect` loops.
- **Migration `0007`** adds a single nullable column correctly.

---

## 5. Round 1 Action Plan

Fix in priority order: **C1** (reset-endpoint escalation) → **C2** (editReply disabled-category bypass) → **M1** (sub-page admin controls) → **M2** (targetUserId===0) → **M3** (system group) → **M4** (matrix overwrite) → minors. Then re-audit (Round 2).

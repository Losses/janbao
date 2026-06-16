# DV03-C03-Journal: Cycle 3 Development Journal

## Cycle 3: Super-Admin & Editable Reserved Entities

**Date:** 2026-06-16
**Status:** Implementation Complete

---

## 1. Work Completed

### 1.1 Super-Admin Promotion Rule

**Modified:** `src/routes/api/admin/users/group/+server.ts`

- Introduced `BOOTSTRAP_ADMIN_ID = 0` and `isValidTargetGroup(slug, isSuperAdmin)`:
  - `system` and `guest` are never assignable as a real user group.
  - `admin` is assignable **only** by the bootstrap super-admin (user `0`).
  - All other groups are assignable by any admin.
- Escalation safety:
  - Peers (non-super-admin admins) cannot change an existing admin's group or their own group (`permissions.adminGroupChangeForbidden`).
  - Even the super-admin cannot demote themselves (lockout prevention).

### 1.2 Profile-Sidebar "Promote to Admin" Button

**Modified:** `src/lib/components/molecules/ProfileSidebar.svelte`

- Added `isSuperAdmin` (`user.id === 0`) and `canPromoteToAdmin` derivations.
- When the super-admin views a non-admin target, a "Promote to Admin" button (`permissions.promoteToAdmin`) appears below the group dropdown; it PATCHes `/api/admin/users/group` with `groupSlug: 'admin'`.
- The ordinary group dropdown remains non-admin-only (admin promotion is a dedicated path, not a dropdown option), preserving the admin-mutual-exclusion UX.

### 1.3 Editable Reserved User Groups

**Created DAO helper:** `updateUserGroupMeta(db, slug, title, description)` in `src/lib/server/db/dao/admin-permissions.ts`.
**Added API:** `PATCH /api/admin/user-groups` (`src/routes/api/admin/user-groups/+server.ts`) - edits title/description, matched by slug. Reserved groups are editable; seeding is idempotent (`onConflictDoNothing`) and never overwrites existing rows, so editing `system`/`admin`/`moderator`/`member`/`guest` is safe. Slug is never mutated.
**Added type:** `AdminUserGroupUpdateBody` in `src/lib/types/api.ts`.

### 1.4 Editable Categories

**No new backend needed** - the existing `PATCH /api/admin/categories` already accepts full metadata (title/description/displayOrder/priority/themeName) and leaves `disabledAt` untouched when `disabled` is omitted.

### 1.5 Reused Add/Edit Modals

**Modified:** `src/routes/admin/user-groups/+page.svelte` and `src/routes/admin/categories/+page.svelte`

- Single shared modal with `modalMode: 'add' | 'edit'`; `openEdit(entity)` pre-fills fields and switches the submit target (POST for add, PATCH for edit).
- Slug field is disabled in edit mode (locked), so reserved groups/categories keep their identity.
- Each table row gained an "Edit" button (`common.edit`) alongside the existing delete/disable/restore actions.

### 1.6 FormField `disabled` Support

**Modified:** `src/lib/components/atoms/FormField.svelte`

- Added an optional `disabled` prop, applied to both input and textarea, so edit modals can lock the slug field.

### 1.7 i18n

**Modified:** `src/lib/i18n/{en,zh-CN}.json`

- `admin.editUserGroup`, `admin.editCategory`.
- `permissions.groupUpdated`, `permissions.categoryUpdated`, `permissions.promoteToAdmin`.

---

## 2. Verification Results

| Check                                              | Result                                                                                                                                                                                                                                                      |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check` (svelte-check)                     | ✅ 0 errors, 0 warnings                                                                                                                                                                                                                                     |
| `bun run lint` (prettier → eslint → similarity-ts) | ✅ Exit code 0                                                                                                                                                                                                                                              |
| Browser walkthrough (admin session, user 0)        | ✅ reserved-group edit modal (slug locked, title change persists); category edit modal (all fields pre-filled, slug locked); "Promote to Admin" button shown for super-admin viewing a non-admin; promotion sets target to `admin` (DB-confirmed, restored) |

colt (id 1158) was promoted to admin during verification and restored to `member` via libsql.

---

## 3. Files Changed

### New Files

- `docs/DV03-Plan.md`
- `docs/DV03-C01-Journal.md`
- `docs/DV03-C02-Journal.md`
- `docs/DV03-C03-Journal.md`

### Modified Files

- `src/routes/api/admin/users/group/+server.ts` (super-admin rule)
- `src/routes/api/admin/user-groups/+server.ts` (PATCH edit)
- `src/lib/server/db/dao/admin-permissions.ts` (`updateUserGroupMeta`)
- `src/lib/components/molecules/ProfileSidebar.svelte` (promote button)
- `src/lib/components/atoms/FormField.svelte` (`disabled` prop)
- `src/routes/admin/user-groups/+page.svelte` (add/edit modal + edit row action)
- `src/routes/admin/categories/+page.svelte` (add/edit modal + edit row action)
- `src/lib/types/api.ts` (`AdminUserGroupUpdateBody`)
- `src/lib/i18n/{en,zh-CN}.json`

---

## 4. Notes

- The super-admin concept is intentionally narrow: only user `0` (the bootstrap admin seeded from `ADMIN_EMAIL`). There is no UI to create additional super-admins; this avoids a privilege-escalation ladder.
- Peer mutual-exclusion is enforced both server-side (API) and client-side (the dropdown never offers `admin`, and the promote button is super-admin-only).
- Reserved-group edits are safe against reseeding because `seedBaseline` uses `onConflictDoNothing` on the slug PK and never updates existing rows.

---

## 5. Audit Round 1 - 2026-06-16

**Method:** 5 independent sub-agents performed full audits of the DV03 diff (`13f289f..4017ef0`). Several agents hit transient 529 gateway errors and were restarted; final reports consolidated into [RV03-C03-Audit-01.md](./RV03-C03-Audit-01.md).

**Round 1 Verdicts:** 4× PASS_WITH_NOTES, 1× PASS_WITH_NOTES-with-CRITICAL-escalation (Agent D). **Consolidated consensus: FAIL** - one CRITICAL privilege-escalation had to be fixed before PASS.

**Issues found & fixed:**

| Severity | Issue                                                                                                                                                                          | Fix                                                                                                                                                                                                                                                                |
| :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRITICAL | Peer admin could take over any admin (incl. super-admin user 0) via `/api/auth/admin-generate-reset` - the reset endpoint authorised only the caller, never the target's group | Endpoint now fetches the target's groupSlug and rejects (403) admin targets unless the caller is the super-admin (id 0); also switched to `requireAdmin` + imported `BOOTSTRAP_ADMIN_ID` from constants; UI "Generate Reset Link" button gated on `canResetTarget` |
| CRITICAL | `editReply` author-bypass let an author edit a reply inside a disabled category (direct form POST)                                                                             | Added `categories` JOIN + `isNull(categories.disabledAt)` to the `editReply` and `deleteReply` reply-fetch queries (disabled-category replies now 404)                                                                                                             |
| MAJOR    | Admin controls absent on `/profile/discussions` and `/profile/comments` (and the props/email never fetched)                                                                    | New `getProfileAdminSidebarData` DAO helper; both sub-page loaders now fetch and pass `targetUserGroupSlug` / `targetUserEmail` / `manageableGroups` to `ProfileSidebar`                                                                                           |
| MAJOR    | `targetUserId === 0` rejected by falsy guard (`!targetUserId`)                                                                                                                 | Replaced with explicit `undefined`/`NaN` check so id 0 is a valid target                                                                                                                                                                                           |
| MAJOR    | System-group sentinel not protected from peer-admin reassignment                                                                                                               | `isProtectedTarget` now also blocks `currentGroupSlug === 'system'` for everyone (super-admin included)                                                                                                                                                            |
| MAJOR    | Permissions-matrix save mass-overwrote untouched rows → potential lockout                                                                                                      | Track a per-category dirty set; save only sends changed rows; Save button disabled until dirty                                                                                                                                                                     |
| MINOR    | Dead i18n keys (`profile.permissionManagement`, `permissions.addCategory`, `permissions.addGroup`)                                                                             | removed (en + zh-CN)                                                                                                                                                                                                                                               |
| MINOR    | `BOOTSTRAP_ADMIN_ID` magic number                                                                                                                                              | exported from `constants.ts`, imported where used                                                                                                                                                                                                                  |
| MINOR    | Unused `ASSIGNABLE_RESERVED_USER_GROUP_SLUGS` export                                                                                                                           | deleted                                                                                                                                                                                                                                                            |
| MINOR    | `deleteGroup` had no confirmation modal (one-click delete)                                                                                                                     | added a confirm modal (`pendingDeleteSlug`)                                                                                                                                                                                                                        |

**Verification after fixes:**

- `bun run check` - 0 errors, 0 warnings
- `bun run lint` - exit code 0
- **C1 verified end-to-end via API:** super-admin (user 0) can reset a member (200); a peer admin (temporarily-promoted colt) is **denied 403** when targeting the super-admin, but can still reset a member. Test data (colt's temporary admin promotion + test password + 2 reset tokens) created and fully restored/cleaned via libsql.

**Status:** Round 1 fixes applied and verified. Proceeding to Round 2 re-audit.

---

## 6. Audit Round 2 - 2026-06-16

**Method:** 5 independent sub-agents re-audited the post-Round-1 working tree. The model gateway hit a sustained 529 outage (10 failed launches, 0 tool-uses); after a 12-min cooldown a probe confirmed recovery and the remaining four were launched. Reports consolidated into [RV03-C03-Audit-02.md](./RV03-C03-Audit-02.md).

**Round 2 Verdicts:** **3× PASS** (unconditional), **2× PASS_WITH_NOTES**. All Round-1 fixes CONFIRMED-FIXED; no regressions.

**New issues found & fixed:**

| Severity | Issue                                                                                                                                                          | Fix                                                                                                        |
| :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| MAJOR    | System sentinel (user -1) still resettable by a peer admin via the reset endpoint (same family as C1, parallel to the M3 `system` protection in `users/group`) | Reset-endpoint guard now blocks `system` unconditionally (no one resets it) and `admin` unless super-admin |
| MINOR    | `canManageTargetGroup` client gate excluded only `admin`, not `system` (server already blocked it; UX-only)                                                    | Added `targetUserGroupSlug !== 'system'` for client/server parity                                          |

**Deliberately not fixed (non-blocking, judged acceptable by multiple PASS agents):** m5 (matrix `$effect` wipe on unrelated `invalidateAll`), m7 (`users/group` TOCTOU), m9 (sequential upsert), m10 (similarity-ts informational).

**Verification after fixes:**

- `bun run check` - 0 errors, 0 warnings
- `bun run lint` - exit code 0 (full chain incl. docs)
- All Round-1 fixes remain CONFIRMED-FIXED; no regressions.

**Status:** Round 2 fixes applied and verified. Proceeding to Round 3 re-audit to seek unanimous unconditional PASS.

---

## 7. Audit Round 3 - 2026-06-16

**Method:** 5 independent sub-agents re-audited after Round 1 + Round 2 fixes (probe-then-batch; gateway stable this round). Reports consolidated into [RV03-C03-Audit-03.md](./RV03-C03-Audit-03.md).

**Round 3 Verdicts:** **4× PASS** (unconditional), **1× PASS_WITH_NOTES** (the lone note was fixed mid-round). N1 + N2 CONFIRMED-FIXED by all 5. No regressions.

**Round-3 fix applied mid-round:**

| Severity | Issue                                                                                                                                                                                                                     | Fix                                                                                        |
| :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------- |
| MINOR    | `canResetTarget` (ProfileSidebar) excluded only `admin`, not `system` - an admin viewing the system sentinel saw the reset button (clicking 403s server-side; no escalation). Same parity gap as N2 on the reset control. | Added `targetUserGroupSlug !== 'system'` to `canResetTarget` for full client/server parity |

**Non-blocking items raised but not withholding PASS** (all hygiene/defense-in-depth or carry-overs, no live vulnerability, no regression): bookmarks-API readable-filter, `validateCategoryPermissionTargets` disabled-category check, permissive `categoryPermissions` schema defaults, and carry-overs m5/m7/m9/m10.

**Pre-existing issues flagged OUTSIDE DV03 scope** (filed for a separate change; predate the `13f289f` baseline, untouched by this feature): notifications discussion-title resolution and the bare-path discussion redirect don't filter `disabledAt`.

**Verification after the Round-3 fix:**

- `bun run check` - 0 errors, 0 warnings
- `bun run lint` - exit code 0 (full chain incl. docs)
- All Round-1 + Round-2 fixes remain CONFIRMED-FIXED; no regressions.

**Status: ✅ UNANIMOUS PASS - audit loop closed.** All 5 agents consider DV03 Cycle 3 complete and clean for its scope.

# DV03-C01-Journal: Cycle 1 Development Journal

## Cycle 1: Initial Permission Management

**Date:** 2026-06-15
**Status:** Implementation Complete

---

## 1. Work Completed

### 1.1 Schema & Migration

**Modified:** `src/lib/server/db/schema.ts`

- Added `disabledAt: integer('disabled_at', { mode: 'timestamp' })` to the `categories` table for soft-delete/restore semantics.

**Created:** `drizzle/local-migrations/0007_nervous_shinko_yamashiro.sql` (+ meta snapshot / journal) via `bun run db:generate:local` - single statement `ALTER TABLE categories ADD disabled_at integer`.

### 1.2 Centralized Disabled-Category Access Rules

**Modified:** `src/lib/server/constants.ts`

- `resolvePermissions(db, categorySlug, user)` now first verifies the category exists and `disabledAt IS NULL`; disabled or missing categories resolve to all-false permissions.
- `getReadableCategorySlugs(db, groupSlug)` now returns **only enabled slugs** and no longer returns `null` for `admin`/`moderator` (it returns the enabled slug list), closing a leak where privileged users could reach disabled categories.

**Modified (filtered `disabledAt IS NULL`):** discussion list/count and post-query read-access filter in `src/lib/server/db/dao/discussions.ts`; bookmarks list/count in `src/lib/server/db/dao/bookmarks.ts`; user comments in `src/lib/server/db/dao/comments.ts`; discussion search metadata + final join in `src/lib/server/db/dao/search.ts`; plus the category list API (`/api/categories`), categories page, single-category page (404 when disabled), category RSS, discussion detail join, post discussion composer, and edit-discussion target-category check.

### 1.3 Admin DAO Helpers & Guard

**Created:** `src/lib/server/db/dao/admin-permissions.ts`

- Reserved-slug constants (`RESERVED_USER_GROUP_SLUGS`) and `isAssignableGroupSlug()` (blocks `system`/`admin`/`guest`).
- `listUserGroupsWithCounts`, `listManageableUserGroups`, `getUserGroupCount`, `userGroupExists`, `createUserGroup`, `deleteUserGroup`.
- `listAdminCategories`, `categoryExists`, `createCategory`, `updateCategory`, `setCategoryDisabled`.
- `listCategoryPermissions`, `upsertCategoryPermissions`, `validateCategoryPermissionTargets`.
- `getTargetUserGroup`, `updateUserGroup`.

**Created:** `src/lib/server/admin.ts`

- `requireAdmin(user, t)` → returns a `jsonError` Response (401/403) or null; `isValidAdminSlug()` (`^[a-z0-9-]{2,40}$`).

### 1.4 Admin APIs

**Created:** `src/routes/api/admin/user-groups/+server.ts` - `GET` list with counts, `POST` create (rejects reserved slug / existing slug / invalid slug), `DELETE` (rejects reserved, rejects group with members).
**Created:** `src/routes/api/admin/categories/+server.ts` - `GET` (incl. disabled), `POST` create, `PATCH` (metadata + disable/restore), `DELETE` (soft delete via `disabledAt`).
**Created:** `src/routes/api/admin/category-permissions/+server.ts` - `PUT` batch upsert (rejects non-assignable group slugs, validates targets).
**Created:** `src/routes/api/admin/users/group/+server.ts` - `PATCH` target user's group (admin-only, non-admin target groups only, blocks admin targets and self).

### 1.5 Single-Page Admin UI

**Created:** `src/routes/profile/permissions/+page.server.ts` + `+page.svelte`

- Admin guard (redirect-to-signin if unauthenticated; 403 if non-admin).
- Loads groups (with counts), categories (incl. disabled), and category permissions.
- Three sections on one page: user-group table, category table (disable/restore), per-group permission matrix.

**Modified:** `src/lib/components/molecules/SettingsSidebar.svelte` - admin-only "Permission Management" item.

### 1.6 Profile Sidebar: Group Dropdown & Link Modals

**Modified:** `src/lib/components/molecules/ProfileSidebar.svelte`

- Removed browser `confirm()`/`alert()`.
- Reset flow: confirm modal → result modal with the generated link.
- Added a no-label `<select>` under "Generate Reset Link" for admins viewing non-admin targets; uses a writable `$derived` (`overrideGroupSlug` + `targetUserGroupSlug`) to satisfy `svelte/prefer-writable-derived`.

**Modified:** `src/routes/api/auth/admin-generate-reset/+server.ts` - selects target `email`; returns `guidance` built server-side from `t.auth.resetLinkGuidance` with the email substituted.

**Modified:** `src/routes/api/invitations/request/+server.ts` - returns `{ code, inviteLink }` so the page can show a modal instead of an alert-style success block.
**Modified:** `src/routes/profile/invitations/+page.svelte` - success opens a DaisyUI modal with the link + copy button; inline feedback kept only for errors.

### 1.7 i18n

**Modified:** `src/lib/i18n/en.json`, `zh-CN.json`

- New top-level `permissions` namespace (labels + error strings).
- `profile.permissionManagement`; `auth.{resetLinkModalTitle,resetLinkGuidance,copyResetLink,resetLinkCopied}`; `invitation.{inviteLinkModalTitle,inviteLinkGuidance,copyInviteLink,inviteLinkCopied}`.

### 1.8 API Types

**Modified:** `src/lib/types/api.ts`

- `AuthAdminGenerateResetResponse` gained `guidance`.
- Added `AdminUserGroupItem`, `AdminCategoryItem`, `AdminCategoryPermissionItem`, `AdminManageableGroupItem`, create/update/delete body interfaces, `InvitationRequestResponse`.

---

## 2. Verification Results

| Check                                              | Result                                                                                                                                                                        |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check` (svelte-check)                     | ✅ 0 errors, 0 warnings                                                                                                                                                       |
| `bun run lint` (prettier → eslint → similarity-ts) | ✅ Exit code 0                                                                                                                                                                |
| Browser walkthrough (admin session)                | ✅ add/delete custom group; disable→404 direct URL→restore category; matrix save; group dropdown change (DB-confirmed, restored); reset modal with target email; invite modal |

Throwaway test data (custom group, test category, test invitation code) created during verification was cleaned via libsql; local DB restored to baseline.

---

## 3. Files Changed

### New Files

- `src/lib/server/admin.ts`
- `src/lib/server/db/dao/admin-permissions.ts`
- `src/routes/api/admin/user-groups/+server.ts`
- `src/routes/api/admin/categories/+server.ts`
- `src/routes/api/admin/category-permissions/+server.ts`
- `src/routes/api/admin/users/group/+server.ts`
- `src/routes/profile/permissions/+page.server.ts`
- `src/routes/profile/permissions/+page.svelte`
- `drizzle/local-migrations/0007_nervous_shinko_yamashiro.sql` (+ meta)

### Modified Files

- `src/lib/server/db/schema.ts`
- `src/lib/server/constants.ts`
- `src/lib/server/db/dao/{discussions,bookmarks,comments,search}.ts`
- `src/routes/{api/categories,+page...}` category/RSS/post/discussion routes (disabled-category filtering)
- `src/lib/components/molecules/{SettingsSidebar,ProfileSidebar}.svelte`
- `src/routes/api/auth/admin-generate-reset/+server.ts`
- `src/routes/api/invitations/request/+server.ts`
- `src/routes/profile/invitations/+page.svelte`
- `src/routes/profile/[userId]/[userSlug]/+page.server.ts`
- `src/lib/types/api.ts`
- `src/lib/i18n/{en,zh-CN}.json`

---

## 4. Notes for Subsequent Cycles

- The single-page UI and scattered inline form fields did not match the app's nav/button+modal conventions - addressed in **C02**.
- The reset/invite copyable blocks were bare links, not semantic sentences - addressed in **C02**.
- Reserved groups are not deletable but should be editable; categories lack an edit affordance - addressed in **C03**.
- No super-admin concept yet: admins cannot promote peers, and the guard rejects all admin-target changes uniformly - addressed in **C03**.

# DV03-C02-Journal: Cycle 2 Development Journal

## Cycle 2: Admin Area Refactor

**Date:** 2026-06-15
**Status:** Implementation Complete

---

## 1. Work Completed

### 1.1 Dedicated `/admin` Multi-Page Area

**Created:** `src/routes/admin/+layout.server.ts`

- Centralized admin guard: redirect-to-signin when unauthenticated, `error(403)` for non-admins. Individual admin pages no longer repeat the guard.

**Created:** `src/routes/admin/+layout.svelte` — thin passthrough (no chrome); each page renders its own `DualColumnLayout` + `AdminSidebar`.

**Created:** `src/routes/admin/+page.server.ts` — `redirect(302, '/admin/user-groups')` so `/admin` lands on the first nav item.

**Created:** three page pairs (server load + Svelte):

- `src/routes/admin/user-groups/+page.{server,svelte}` — table (counts, reserved/custom status, delete) + "Add User Group" button → modal.
- `src/routes/admin/categories/+page.{server,svelte}` — table (status, disable/restore) + "Add Category" button → modal.
- `src/routes/admin/permissions/+page.{server,svelte}` — group selector + read/create/update/delete matrix over enabled categories + Save.

**Deleted:** `src/routes/profile/permissions/+page.{server,svelte}` and its `SettingsSidebar` entry — the feature no longer lives under `/profile`.

### 1.2 Admin Entry Icon

**Modified:** `src/lib/components/molecules/UserInfoBlock.svelte`

- Added a 5th icon button (`mdiShieldAccount` → `/admin`), admin-only, styled identically to the notifications/messages/bookmarks/settings icons (`btn btn-ghost btn-xs sidebar-icon-btn`), with i18n `admin.adminPanel` aria-label/title. Non-admins never see it.

### 1.3 AdminSidebar Component

**Created:** `src/lib/components/molecules/AdminSidebar.svelte`

- Mirrors `SettingsSidebar`: `UserInfoBlock` + `<ul class="menu menu-sm w-full gap-1">` with three nav items (User Groups / Categories / Category Permissions) and `activeItem` highlighting.

### 1.4 Reusable FormField Atom

**Created:** `src/lib/components/atoms/FormField.svelte`

- Abstracts the register-page pattern: `<div class="form-control">` → label-on-top (`label text-sm font-semibold`) → `input input-bordered w-full` (or `textarea` via `as="textarea"`) → optional error `<p>` or `hint` snippet.
- Bindable `value`; props: `label`, `id`, `type`, `placeholder`, `required`, `error`, `as`, `rows`, `maxlength`, `class`.

**Modified:** `src/routes/entry/register/+page.svelte` — replaced the six hand-written field blocks with `<FormField>`; password-strength kept via the `hint` snippet.

### 1.5 Button + Modal Add Flows

- User-groups and categories pages: an "Add" button opens a DaisyUI modal containing a `<form>` built from `FormField`. Submit → existing admin API; on success, `invalidateAll()` + close modal.
- Categories modal fields: slug, title, description (textarea), displayOrder, priority (number, bound via local string state), themeName.

### 1.6 Invitation-Style Table Dividers

- All admin tables use `table table-sm [&_tr]:border-base-300`, matching the existing invitation table.

### 1.7 Polished Copyable Link Sentences (i18n)

**Modified:** `src/lib/components/molecules/ProfileSidebar.svelte`

- Added `targetUserEmail` prop; the reset copyable block is now the i18n sentence `auth.resetLinkCopyText` with `{email}`/`{link}` substituted. The copy button copies the whole sentence.

**Modified:** `src/routes/profile/invitations/+page.svelte` — invitation copyable block becomes `invitation.inviteLinkCopyText` with `{link}` substituted; copy copies the sentence.

**Modified:** `src/routes/profile/[userId]/[userSlug]/+page.server.ts` — returns `targetUserEmail` to admins only, fetched in a separate query and never included in the public `targetUser` payload (no email leak to non-admin viewers).
**Modified:** `src/routes/profile/[userId]/[userSlug]/+page.svelte` — passes `targetUserEmail` into `ProfileSidebar`.

### 1.8 i18n

**Modified:** `src/lib/i18n/{en,zh-CN}.json`

- New top-level `admin` namespace (`title`, `userGroups`, `categories`, `categoryPermissions`, `addUserGroup`, `addCategory`, `adminPanel`, `newGroup`, `newCategory`).
- `auth.resetLinkCopyText`, `invitation.inviteLinkCopyText`.

---

## 2. Verification Results

| Check                                              | Result                                                                                                                                                                                                                               |
| :------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check` (svelte-check)                     | ✅ 0 errors, 0 warnings                                                                                                                                                                                                              |
| `bun run lint` (prettier → eslint → similarity-ts) | ✅ Exit code 0                                                                                                                                                                                                                       |
| Browser walkthrough (admin session)                | ✅ admin icon visible (admin-only); `/admin` → `/admin/user-groups`; user-groups add→table→delete cycle; categories disable/restore; permission matrix; reset copyable sentence with real email + link; invitation copyable sentence |

Test reset token + invitation code generated during verification were cleaned via libsql.

---

## 3. Files Changed

### New Files

- `src/lib/components/atoms/FormField.svelte`
- `src/lib/components/molecules/AdminSidebar.svelte`
- `src/routes/admin/+layout.{server,svelte}`
- `src/routes/admin/+page.server.ts`
- `src/routes/admin/user-groups/+page.{server,svelte}`
- `src/routes/admin/categories/+page.{server,svelte}`
- `src/routes/admin/permissions/+page.{server,svelte}`

### Modified Files

- `src/routes/entry/register/+page.svelte`
- `src/lib/components/molecules/UserInfoBlock.svelte`
- `src/lib/components/molecules/ProfileSidebar.svelte`
- `src/lib/components/molecules/SettingsSidebar.svelte`
- `src/routes/profile/[userId]/[userSlug]/+page.{server,svelte}`
- `src/routes/profile/invitations/+page.svelte`
- `src/lib/i18n/{en,zh-CN}.json`

### Deleted Files

- `src/routes/profile/permissions/+page.server.ts`
- `src/routes/profile/permissions/+page.svelte`

---

## 4. Notes for Subsequent Cycles

- Escalation safety is coarse: the group-change API rejects _all_ admin targets and self, so no admin can promote a peer. **C03** introduces a super-admin (user `0`) carve-out.
- Reserved user groups and categories are not editable (only deletable for custom groups, disable/restore for categories). **C03** adds edit modals reusing the add-modal structure.
- The profile-sidebar group dropdown correctly excludes `admin` as an option today; with the C03 super-admin rule, promotion to `admin` happens through a dedicated path rather than the dropdown.

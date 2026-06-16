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
**Added API:** `PATCH /api/admin/user-groups` (`src/routes/api/admin/user-groups/+server.ts`) — edits title/description, matched by slug. Reserved groups are editable; seeding is idempotent (`onConflictDoNothing`) and never overwrites existing rows, so editing `system`/`admin`/`moderator`/`member`/`guest` is safe. Slug is never mutated.
**Added type:** `AdminUserGroupUpdateBody` in `src/lib/types/api.ts`.

### 1.4 Editable Categories

**No new backend needed** — the existing `PATCH /api/admin/categories` already accepts full metadata (title/description/displayOrder/priority/themeName) and leaves `disabledAt` untouched when `disabled` is omitted.

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

| Check | Result |
| :--- | :--- |
| `bun run check` (svelte-check) | ✅ 0 errors, 0 warnings |
| `bun run lint` (prettier → eslint → similarity-ts) | ✅ Exit code 0 |
| Browser walkthrough (admin session, user 0) | ✅ reserved-group edit modal (slug locked, title change persists); category edit modal (all fields pre-filled, slug locked); "Promote to Admin" button shown for super-admin viewing a non-admin; promotion sets target to `admin` (DB-confirmed, restored) |

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

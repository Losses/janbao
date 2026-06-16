# DV03-Plan: Permission Management & Administration Area

## 1. Executive Summary

This document plans the addition of a full **administrator permission-management system** for Janbao: the ability for admins to manage non-admin user groups, soft-disable/restore categories, configure per-group category permissions, change a user's identity group from their profile, and replace the legacy browser `alert()`/`confirm()` link flows with i18n-driven DaisyUI modals.

The work is partitioned into three sequential **Development Cycles**:

- **Cycle 1 (C01)** — Initial implementation: schema + migration, centralized disabled-category access rules, admin APIs, a single-page settings UI under `/profile/permissions`, the profile-sidebar group dropdown, and the reset/invite link modals.
- **Cycle 2 (C02)** — Refactor: move the feature into a dedicated multi-page `/admin` area with its own sidebar; add an admin-only entry icon in the user-info block; abstract the register-page form-field pattern into a reusable `FormField` atom; convert "Add" flows to button + modal; and rewrite the link copyable blocks as polished i18n sentences.
- **Cycle 3 (C03)** — Detail fixes: a super-admin rule (user `0` may promote others to `admin`; admins may not alter each other), and editable (not just deletable) reserved user groups and categories via reused modals.

The goal throughout is to follow the existing architecture: SvelteKit + Svelte 5 runes, Drizzle ORM, Cloudflare D1 (libsql locally), strict lint rules (no inline typing, interface-first, similarity-ts), and the atomic component design paradigm.

---

## 2. Requirements

### 2.1 Admin-Only Visibility & Guarding

- Only users in the `admin` group can reach the management UI. Non-admins must be blocked (403 on direct URL; the nav entry hidden).
- The admin guard lives at the route layout level so individual pages need not repeat it.

### 2.2 User Groups

- Admins can **add** and **delete** custom (non-reserved) user groups. A group that still has members cannot be deleted.
- Reserved slugs (`system`, `admin`, `moderator`, `member`, `guest`) cannot be deleted — but they **can be edited** (title/description). Seeding is idempotent (`onConflictDoNothing`) and never overwrites existing rows, so editing reserved groups is safe.
- Reserved groups and groups with members show a disabled delete button.

### 2.3 Categories (Soft Delete / Restore)

- Admins can **add**, **disable**, and **restore** categories.
- Disabling is a soft delete: `categories.disabledAt` timestamp set; data preserved; restorable.
- A disabled category is **inaccessible everywhere** outside the admin UI: list, sidebar, post composer, search, bookmarks, discussion lists/counts, RSS, and direct URL (404).
- Categories are also **editable** (title/description/order/priority/theme) via a reused modal.

### 2.4 Category Permissions

- Configured per non-admin user group as a read/create/update/delete matrix over enabled categories.
- The `admin` group is never editable in the matrix (always full access).

### 2.5 User Identity Group (Profile Sidebar)

- Under "Generate Reset Link" in `ProfileSidebar`, admins see a no-label `<select>` matching the reset button's size, to change a target user's group directly.
- `admin`, `guest`, and `system` are not assignable via the dropdown.
- **Super-admin rule (C03):** user `0` may set any other user to `admin`. Otherwise, admins cannot change an existing admin's group, nor change their own group (lockout/escalation prevention).

### 2.6 Link Flows (Modals, Not Alerts)

- Reset-link and invitation-link generation use DaisyUI modals — no browser `alert()`/`confirm()`.
- The copyable block in each modal is a polished i18n **sentence**, not a bare link:
  - Reset: "Your account email is {email}. To reset your password, open this link: {link}"
  - Invitation: "To join the forum, open this link and register: {link}"
- The reset sentence incorporates the **target user's email** to avoid sending the link to the wrong person.

### 2.7 Reusable Form Field

- A `FormField` atom abstracts the register page pattern: label-on-top (`label text-sm font-semibold`) above an `input input-bordered w-full` (or textarea), with an optional hint snippet. Both the register page and the admin add/edit modals use it.

---

## 3. Development Cycles

### Cycle 1 (C01): Initial Permission Management

- **Goal:** Deliver the full feature on a single settings page under `/profile/permissions`, plus the sidebar group dropdown and link modals.
- **Tasks:**
  - Schema: add `categories.disabledAt` (nullable timestamp) + Drizzle local migration `0007`.
  - Centralize access rules in `src/lib/server/constants.ts`: `resolvePermissions()` returns all-false for disabled/missing categories; `getReadableCategorySlugs()` returns only enabled slugs (no longer `null` for admin/moderator).
  - Filter disabled categories across `discussions`, `bookmarks`, `comments`, `search` DAOs and the category/list/RSS/post routes (JOIN `categories`, `disabledAt IS NULL`).
  - Admin DAO helpers in `src/lib/server/db/dao/admin-permissions.ts` (reserved-slug guards, group counts, category disable/restore, permission upsert).
  - Admin APIs under `src/routes/api/admin/` (`user-groups`, `categories`, `category-permissions`, `users/group`), all guarded by `requireAdmin()` in `src/lib/server/admin.ts`.
  - Single-page UI at `/profile/permissions` (groups + categories + permission matrix) and a settings-sidebar entry.
  - `ProfileSidebar`: group `<select>` + reset/invite modals (replacing `alert()`/`confirm()`); reset API returns `guidance` with the target email.
- **Verification:** `bun run check` + `bun run lint`; browser walkthrough of add/delete group, disable/restore category (direct URL 404s when disabled), permission save, group change, reset/invite modals.

### Cycle 2 (C02): Admin Area Refactor

- **Goal:** Restructure the feature to match the app's conventions.
- **Tasks:**
  - Move management into a dedicated multi-page `/admin` area: layout-level admin guard, `AdminSidebar`, `/admin` → `/admin/user-groups` redirect, three pages (user-groups, categories, permissions).
  - Add an admin-only 5th icon (`mdiShieldAccount` → `/admin`) in `UserInfoBlock`.
  - New `FormField` atom; refactor the register page to use it.
  - Convert "Add" flows to button + modal built from `FormField`.
  - All tables adopt the invitation-table divider style `table table-sm [&_tr]:border-base-300`.
  - Link copyable blocks become polished i18n sentences (`auth.resetLinkCopyText`, `invitation.inviteLinkCopyText`). Target email passed into `ProfileSidebar` as `targetUserEmail` (fetched only for admins, separately, so it never leaks to non-admin viewers).
  - Delete the old `/profile/permissions` and its settings-sidebar entry.
- **Verification:** `bun run check` + `bun run lint`; browser walkthrough of admin icon visibility, `/admin` redirect, non-admin 403, add-modal create→table→delete cycle, matrix save, reset/invite copyable sentences.

### Cycle 3 (C03): Super-Admin & Editable Reserved Entities

- **Goal:** Fix detail issues around escalation safety and missing edit affordances.
- **Tasks:**
  1. **Super-admin promotion:** relax `/api/admin/users/group` so that user `0` (the bootstrap admin) can assign the `admin` group to another user. All other admins are forbidden from changing an existing admin's group and from changing their own group.
  2. **Admin-mutual-exclusion:** ensure the profile-sidebar group dropdown cannot change an admin target (and reflects that the `admin` group is only reachable via the super-admin path). The dropdown remains a no-label control sized to match the reset button.
  3. **Editable reserved user groups:** allow editing title/description of `system`/`admin`/`moderator`/`member`/`guest` via a reused edit modal (slug stays read-only for reserved groups). Seeding remains idempotent and non-destructive.
  4. **Editable categories:** allow editing title/description/displayOrder/priority/themeName of any category (enabled or disabled) via a reused edit modal, in addition to disable/restore.
  5. **Modal reuse:** both edit flows reuse the existing add-modal structure (and `FormField`); differentiate by pre-filling fields and switching the submit target (PATCH vs POST). Add an "Edit" action per row alongside disable/restore/delete.
  6. **i18n:** add `admin.editUserGroup`, `admin.editCategory`, `admin.save` (or reuse `common.submit`), and any missing labels.
- **Verification:**
  - As user `0`, promote a member to admin (succeeds); as a non-0 admin, attempting to change another admin or self fails with the admin-mutual-exclusion error.
  - Edit a reserved group's title/description (succeeds, slug unchanged); seed-baseline re-run does not revert it.
  - Edit a category's fields; disable then edit; restore.
  - `bun run check` + `bun run lint`.

---

## 4. Files Touched (representative)

| Area               | Files                                                                                                                                                                                                             |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema / migration | `src/lib/server/db/schema.ts`, `drizzle/local-migrations/0007_*.{sql,meta}`                                                                                                                                       |
| Access rules       | `src/lib/server/constants.ts`, `src/lib/server/db/dao/{discussions,bookmarks,comments,search}.ts`, category/RSS/post routes                                                                                       |
| Admin DAO & guard  | `src/lib/server/db/dao/admin-permissions.ts`, `src/lib/server/admin.ts`                                                                                                                                           |
| Admin APIs         | `src/routes/api/admin/{user-groups,categories,category-permissions,users/group}/+server.ts`, `src/routes/api/auth/admin-generate-reset/+server.ts`, `src/routes/api/invitations/request/+server.ts`               |
| Admin UI           | `src/routes/admin/+layout.{server,svelte}`, `src/routes/admin/+page.server.ts`, `src/routes/admin/{user-groups,categories,permissions}/+page.{server,svelte}`, `src/lib/components/molecules/AdminSidebar.svelte` |
| Atoms / shared     | `src/lib/components/atoms/FormField.svelte`, `src/lib/components/molecules/{UserInfoBlock,ProfileSidebar,SettingsSidebar}.svelte`                                                                                 |
| Profile load       | `src/routes/profile/[userId]/[userSlug]/+page.{server,svelte}`                                                                                                                                                    |
| i18n               | `src/lib/i18n/{en,zh-CN}.json` (top-level `admin` + `permissions` namespaces, `auth`/`invitation` link keys)                                                                                                      |

---

## 5. Existing Patterns to Reuse

| Pattern                                           | Source                                        | Usage                              |
| :------------------------------------------------ | :-------------------------------------------- | :--------------------------------- |
| `DualColumnLayout` + sidebar snippet              | settings/profile pages                        | admin pages                        |
| `SettingsSidebar`/`ProfileSidebar` nav pattern    | `src/lib/components/molecules/`               | `AdminSidebar`                     |
| Register-page label/input style                   | `src/routes/entry/register/+page.svelte`      | `FormField` atom                   |
| DaisyUI modal                                     | `ConfirmationModal.svelte`, `ProfileSidebar`  | add/edit/link modals               |
| Invitation table dividers                         | `src/routes/profile/invitations/+page.svelte` | all admin tables                   |
| `resolvePermissions` / `getReadableCategorySlugs` | `src/lib/server/constants.ts`                 | disabled-category filtering        |
| `jsonError(t, key, status)`                       | `src/lib/server/errors.ts`                    | admin API errors                   |
| `onConflictDoNothing` idempotent seed             | `src/lib/server/db/seed-baseline.ts`          | safety for editing reserved groups |

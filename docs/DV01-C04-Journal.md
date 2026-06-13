# DV01-C04-Journal: Cycle 4 Development Journal

## Cycle: 4 — Permissions Fallback, Mistranslations & Mentions

**Date:** 2026-06-12
**Target Issues:** QA #8, QA #9, QA #13
**Status:** ✅ Complete

---

## 1. Summary

Cycle 4 addresses three critical areas:

1. **Guest Permission Fallback (QA #13):** Unauthenticated visitors were defaulting to `member` group permissions, giving them unintended write access. This cycle introduces a dedicated `guest` user group with read-only public access.
2. **Mention Resolution & Chip Rendering (QA #8):** `@username` mentions in rich text content were displayed as plain text. This cycle adds server-side mention resolution and client-side chip rendering.
3. **Translation Key Audit (QA #9):** Verified that "动态" was already correctly keyed as `"activities"` (not `"dynamics"`) in both i18n files. No refactoring was needed.

---

## 2. Changes Made

### 2.1 Database Seeding — Guest User Group

**File:** `src/lib/server/db/seed.ts`

- Added `'guest'` user group to `groupsToSeed` array with `permissionsJson: '{}'`.
- Guests get empty permissions — all CRUD flags default to false except where `resolvePermissions` applies role-based defaults.

### 2.2 Centralized Permission Resolution

**File:** `src/lib/server/constants.ts`

- Created `resolvePermissions(db, categorySlug, user)` async function that:
  - Queries `categoryPermissions` for the given `(categorySlug, groupSlug)` pair.
  - Falls back to role-based defaults when no DB record exists:
    - **guest:** `canRead=true`, rest `false`
    - **member:** `canRead=true`, `canCreate=true`, rest `false`
    - **admin/moderator:** all `true`
- Created `resolveGroupSlug(user)` helper returning `user?.groupSlug || 'guest'`.
- Exported `ResolvedPermissions` interface.

### 2.3 Permission Loaders Updated

All page server loaders that previously used `user?.groupSlug || 'member'` now use the centralized helpers:

| File                                                           | Change                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/routes/category/[categorySlug]/+page.server.ts`           | Uses `resolvePermissions()` instead of inline query         |
| `src/routes/discussion/[...]/+page.server.ts` (load + actions) | Uses `resolvePermissions()` for read, create, delete checks |
| `src/routes/categories/+page.server.ts`                        | Uses `resolveGroupSlug()` for permission mapping            |
| `src/routes/post/discussion/+page.server.ts`                   | Uses `resolvePermissions()` and `resolveGroupSlug()`        |

### 2.4 Secure Listings — Category Permission Filtering

**File:** `src/lib/server/db/dao/discussions.ts`

- Added optional `groupSlug` parameter to `getDiscussionsList()` and `getDiscussionsCount()`.
- Post-query filtering via `filterByCategoryReadAccess()` removes rows from categories the user/guest cannot read.
- Added `getReadableCategorySlugs()` helper for batch category permission resolution.

**File:** `src/lib/server/db/dao/comments.ts`

- Added optional `groupSlug` parameter to `getUserComments()`.
- Filters discussion replies by readable categories; activity comments are not category-scoped.

**Callers updated:**

- `src/routes/+page.server.ts` — passes `groupSlug`
- `src/routes/profile/discussions/[userId]/[userSlug]/+page.server.ts` — passes `groupSlug`
- `src/routes/profile/comments/[userId]/[userSlug]/+page.server.ts` — passes `groupSlug`

### 2.5 Mention Resolution Server Utility

**New file:** `src/lib/server/utils/mentions.ts`

- `resolveMentions(contentJsons, db)` scans Lexical JSON strings for `@username` patterns.
- Uses existing `extractMentions()` from `$lib/utils/mentions.ts`.
- Batch-queries the `users` table for matched usernames.
- Returns `MentionedUsersMap` (keyed by username → `{id, displayName, username, avatarFileId}`).

### 2.6 Shared Mention Types

**New file:** `src/lib/types/mentions.ts`

- Defines `MentionedUserEntry` interface and `MentionedUsersMap` type.
- Shared across server utility, LexicalRenderer, ActivityRow, and PrivateMessageWindow.

### 2.7 Mention Resolution in Load Handlers

All content-serving load handlers now call `resolveMentions()` and return `mentionedUsers`:

| File                                                              | Content Sources            |
| ----------------------------------------------------------------- | -------------------------- |
| `src/routes/discussion/[...]/+page.server.ts`                     | OP + reply contentJsons    |
| `src/routes/activity/+page.server.ts`                             | Activity list contentJsons |
| `src/routes/profile/[userId]/[userSlug]/+page.server.ts`          | Profile activities         |
| `src/routes/messages/[id]/[[page=page]]/+page.server.ts`          | Message contentJsons       |
| `src/routes/profile/comments/[userId]/[userSlug]/+page.server.ts` | Comment contentJsons       |

### 2.8 LexicalRenderer — @mention Chip Rendering

**File:** `src/lib/components/molecules/LexicalRenderer.svelte`

- Added `mentionedUsers?: MentionedUsersMap | null` prop.
- New `parseMentions(text)` function splits text into `{kind: 'text' | 'mention'}` segments.
- Mention segments render as `<a>` links styled as chips (`bg-primary/15 text-primary rounded`), linking to `/profile/{userId}/{username}`.
- Falls back to plain text if username not in map.

### 2.9 Component Props Updated

- **ActivityRow.svelte:** Added `mentionedUsers` prop, passes to `<LexicalRenderer>`.
- **PrivateMessageWindow.svelte:** Added `mentionedUsers` prop, passes to `<LexicalRenderer>`.
- **Discussion detail page:** Passes `mentionedUsers={data.mentionedUsers}` to all LexicalRenderer instances.
- **Activity page:** Passes `mentionedUsers={data.mentionedUsers}` to all ActivityRow instances.
- **Profile page:** Passes `mentionedUsers={data.mentionedUsers}` to all ActivityRow instances.
- **Profile comments page:** Passes `mentionedUsers={data.mentionedUsers}` to LexicalRenderer.

### 2.10 Pre-existing Lint Fixes

Fixed lint issues found during this cycle's lint run:

- Removed unused `LexicalCommand` import from `RichTextToolbar.svelte`.
- Removed unused `editor` prop from `RichTextToolbar.svelte` and its destructuring in `LexicalEditor.svelte`.
- Removed unused `preventDefault()` function from `RichTextToolbar.svelte`.
- Formatted `src/app.css` with Prettier.
- Removed unused `categoryPermissions` import from discussion detail page.
- Removed unused `resolveGroupSlug` import from discussions DAO.
- Removed unused `inArray` import from comments DAO.

---

## 3. Verification

- [x] `bun run check` — 0 errors, 0 warnings
- [x] `bun run lint` — prettier ✓, eslint ✓, similarity-ts ✓ (type duplicates: 0)
- [x] Guest users fallback to `'guest'` groupSlug, not `'member'`
- [x] Discussion lists filtered by category read permissions
- [x] User comments filtered by category read permissions
- [x] `@username` mentions render as styled chips in all content views
- [x] All load handlers return `mentionedUsers` map

---

## 4. Audit Log

### Audit Round 1 (RV01-C04-Audit-01)

- **Date:** 2026-06-12
- **Method:** 5 independent agents
- **Issues Found:** 6 (all fixed)
- **Result:** All actionable findings resolved. See [RV01-C04-Audit-01.md](./RV01-C04-Audit-01.md).

### Audit Round 2 (RV01-C04-Audit-02)

- **Date:** 2026-06-12
- **Method:** 5 independent agents (full re-audit of all C04 files)
- **Verdicts:** 4 PASS / 1 FAIL → All fixed
- **Issues Found:** 7 (all fixed)
- **Key Fixes:**
  - F1 (Critical): Bookmarks page `totalPages` computed from unfiltered count — refactored to use SQL-level category filtering via `getReadableCategorySlugs`
  - F2: Dead ternary `guest ? true : true` simplified to `true`
  - F3: Duplicate `RecipientInfo` extracted to `$lib/types/api.ts`
  - F4: Bookmarks admin/moderator shortcut added via `getReadableCategorySlugs` (returns `null` for privileged groups)
  - F5: ActivityRow `TranslationDict` replaced with canonical import from `$lib/types/translation`
  - F6: RSS endpoint reduced to minimal column selection (`groupSlug` only)
  - F7: `resolvePermissions` inline fallback replaced with `resolveGroupSlug()` call
- **Verification:** `bun run check` ✅ (0 errors), `bun run lint` ✅ (0 type duplicates)
- **See:** [RV01-C04-Audit-02.md](./RV01-C04-Audit-02.md)

### Audit Round 3 — Verification Pass

- **Date:** 2026-06-12
- **Method:** 5 independent agents (full re-audit after Round 2 fixes)
- **Verdicts:** 5/5 PASS ✅ — All auditors confirm C04 is complete
- **Issues Found:** 0 critical, 0 medium. Low-priority items noted: wasteful double-query in `getDiscussionsCount`, `['__none__']` sentinel pattern, post-query filtering consistency with `getDiscussionsList` — all deferred to follow-up optimization cycle.
- **Verification:** `bun run check` ✅ (0 errors), `bun run lint` ✅ (0 type duplicates)
- **Conclusion:** All 5 independent auditors agree C04 is complete and ready for merge. Audit cycle closed.

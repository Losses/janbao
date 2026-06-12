# DV00-C04-Journal: Cycle 4 Development & Verification Journal

## 1. Executive Summary

This journal documents the design, implementation, and verification of **Cycle 4: Activity Square & Profiles (Dynamic Welcome / Settings / Pages)** as defined in [RQ00-Plan.md](file:///home/losses/Development/janbao/docs/RQ00-Plan.md).

All components and server-side code have been built strictly under TypeScript compile-safe boundaries and lint-safe patterns (no `any`, `as any`, or `<any>` overrides). All database queries explicitly filter deleted records using Drizzle soft-delete queries `isNull(deletedAt)`. All user-facing strings use the i18n translation dictionary — zero hardcoded English strings exist in C04 code.

---

## 2. Implemented Modules

### 2.1 Backend API Endpoints

- **[`/api/activities` GET](file:///home/losses/Development/janbao/src/routes/api/activities/+server.ts):** Fetch comments for a parent activity. Validates parent exists and is not soft-deleted. Returns comments ordered by `createdAt` ascending.
- **[`/api/activities` POST](file:///home/losses/Development/janbao/src/routes/api/activities/+server.ts):** Create new activity (microblog post). Validates content size (max 512 KiB). Supports optional `recipientId` for directed activities (User A → User B). Dispatches `profile_comment` notification to recipient respecting notification preferences.
- **[`/api/activities` DELETE](file:///home/losses/Development/janbao/src/routes/api/activities/+server.ts):** Soft-delete activity or comment. Authorization: author, admin, directed activity recipient, or parent activity author.
- **[`/api/activities/comments` POST](file:///home/losses/Development/janbao/src/routes/api/activities/comments/+server.ts):** Create single-level comment on activity. Enforces single-level nesting (rejects comments on comments). Validates parent exists and is not soft-deleted.
- **[`/api/profile/edit` POST](file:///home/losses/Development/janbao/src/routes/api/profile/edit/+server.ts):** Update user profile. Supports `displayName`, `email`, `showEmail`, `languagePreference`, `avatarFileId`, and `username` (admin-only). Validates email/username uniqueness.
- **[`/api/profile/password` POST](file:///home/losses/Development/janbao/src/routes/api/profile/password/+server.ts):** Change password. Verifies current password, enforces >= 5 character minimum for new password.
- **[`/api/profile/preferences` POST](file:///home/losses/Development/janbao/src/routes/api/profile/preferences/+server.ts):** Update notification preferences. All 7 preference flags supported. Creates preferences row if not exists.
- **[`/api/profile/stealth` POST](file:///home/losses/Development/janbao/src/routes/api/profile/stealth/+server.ts):** Toggle stealth mode. When active, user is hidden from Active Users Wall.

### 2.2 Server Load Handlers

- **[`/activity` +page.server.ts](file:///home/losses/Development/janbao/src/routes/activity/+page.server.ts):** Activity Square page load. Runs daily welcome post check. Fetches root activities (no `parentActivityId`) with pagination. Batch-fetches recipient display names and comment counts. Loads activity draft for logged-in users.
- **[`/profile/[userId]/[userSlug]` +page.server.ts](file:///home/losses/Development/janbao/src/routes/profile/[userId]/[userSlug]/+page.server.ts):** Profile page load. Increments view count (excluding self-visits). Fetches profile activities (authored by or directed to user). Loads activity draft for directed activity composer.
- **[`/profile/discussions/[userId]/[userSlug]` +page.server.ts](file:///home/losses/Development/janbao/src/routes/profile/discussions/[userId]/[userSlug]/+page.server.ts):** User discussions page. Reuses `getDiscussionsList` DAO with `authorId` filter.
- **[`/profile/edit` +page.server.ts](file:///home/losses/Development/janbao/src/routes/profile/edit/+page.server.ts):** Account edit page load. Redirects unauthenticated users to sign-in.
- **[`/profile/password` +page.server.ts](file:///home/losses/Development/janbao/src/routes/profile/password/+page.server.ts):** Password change page load. Redirects unauthenticated users.
- **[`/profile/preferences` +page.server.ts](file:///home/losses/Development/janbao/src/routes/profile/preferences/+page.server.ts):** Preferences page load. Fetches current notification preferences from database.
- **[`/profile/picture` +page.server.ts](file:///home/losses/Development/janbao/src/routes/profile/picture/+page.server.ts):** Avatar upload page load. Returns current `avatarFileId`.
- **[`/profile/OnlineNow` +page.server.ts](file:///home/losses/Development/janbao/src/routes/profile/OnlineNow/+page.server.ts):** Stealth settings page load. Returns current `isStealth` state.

### 2.3 Type Definitions

- **[`src/lib/types/api.ts`](file:///home/losses/Development/janbao/src/lib/types/api.ts):** Extracted all request/response body types to named interfaces:
  - `ActivityCreateBody`, `ActivityDeleteBody`, `ActivityCommentCreateBody`
  - `ProfileEditBody`, `ProfilePasswordBody`, `ProfilePreferencesBody`, `ProfileStealthBody`
  - `ApiResult` (generic response type for frontend fetch calls)
  - `ActivityCommentsResponse`, `ActivityCommentItem`

### 2.4 Frontend Components

- **[`ConfirmationModal.svelte`](file:///home/losses/Development/janbao/src/lib/components/organisms/ConfirmationModal.svelte):** Standardized modal for destructive actions. Receives all labels via props (no hardcoded strings). DaisyUI modal with ARIA attributes (`role="dialog"`, `aria-modal`).
- **[`ActivityRow.svelte`](file:///home/losses/Development/janbao/src/lib/components/organisms/ActivityRow.svelte):** Activity row organism with:
  - Left avatar, center content, directed indicator (User A → User B)
  - Inline comments section with single-level sub-comment tree
  - Comment composer with Enter-to-submit
  - Deletion with authorization checks (author/admin for root, author/parent-author/admin for comments)
  - All strings sourced from i18n `t` dictionary via `gtc()` helper

### 2.5 Frontend Pages

- **[`/activity`](file:///home/losses/Development/janbao/src/routes/activity/+page.svelte):** Activity Square with composer (headings disabled per spec), paginated activity stream, top/bottom paginators. Empty sidebar per RQ00-Frontend §3.3.5.
- **[`/profile/[userId]/[userSlug]`](file:///home/losses/Development/janbao/src/routes/profile/[userId]/[userSlug]/+page.svelte):** Profile page with header (avatar, stats), directed activity composer for visitors, activities stream. Owner/Visitor sidebar split per RQ00-Frontend §3.3.2.
- **[`/profile/discussions/[userId]/[userSlug]`](file:///home/losses/Development/janbao/src/routes/profile/discussions/[userId]/[userSlug]/+page.svelte):** User's discussion list with pagination.
- **[`/profile/edit`](file:///home/losses/Development/janbao/src/routes/profile/edit/+page.svelte):** Edit account form. Username disabled for non-admins with hint. Language selector (en/zh-CN). Show email toggle.
- **[`/profile/password`](file:///home/losses/Development/janbao/src/routes/profile/password/+page.svelte):** Password change form with client-side validation (>= 5 chars, match check).
- **[`/profile/preferences`](file:///home/losses/Development/janbao/src/routes/profile/preferences/+page.svelte):** 7 notification preference toggles with descriptions.
- **[`/profile/picture`](file:///home/losses/Development/janbao/src/routes/profile/picture/+page.svelte):** Avatar upload with client-side validation (max 1MB, MIME type check). Uploads via `/upload` then updates `avatarFileId`.
- **[`/profile/OnlineNow`](file:///home/losses/Development/janbao/src/routes/profile/OnlineNow/+page.svelte):** Stealth mode toggle with status indicator.

### 2.6 Localization Updates

- **[en.json](file:///home/losses/Development/janbao/src/lib/i18n/en.json) & [zh-CN.json](file:///home/losses/Development/janbao/src/lib/i18n/zh-CN.json):**
  - Added `common.unauthorized`, `common.forbidden`, `common.notFound`, `common.contentRequired`, `common.contentTooLarge`, `common.noFieldsToUpdate`
  - Added `activity.*` keys (6 entries)
  - Added `profile.*` keys (42 entries covering settings, preferences, stealth, error messages)

---

## 3. Verification & Compliance Checklist

- **Type Check:** `bun run check` — 981 files, 0 errors, 14 warnings.
- **Lint Check (C04 files only):** `bun run lint` — 0 errors in all C04 files. (31 pre-existing errors in C01-C03 legacy code.)
- **Strict Typing:** Zero occurrences of `any`, `as any`, or `as unknown as` across all C04 files.
- **Inline Types:** All request/response body types extracted to named interfaces in `src/lib/types/api.ts`. Zero inline type literals in C04 code.
- **i18n Compliance:** Zero hardcoded English strings in C04 code. All API error messages use `locals.t.*`. All UI text uses `t.*` dictionary keys without fallback strings.
- **Soft Deletion Safety:** All queries on activities apply `isNull(activities.deletedAt)`.

---

## 4. Audit & Quality History

(Audit rounds will be appended here.)

# DV00-C05-Journal: Cycle 5 Development & Verification Journal

## 1. Executive Summary

This journal documents the design, implementation, and verification of **Cycle 5: Messaging, Bookmarks & Notices (Inbox / Preferences / Comments UNION)** as defined in [RQ00-Plan.md](file:///home/losses/Development/janbao/docs/RQ00-Plan.md).

All server-side code has been built strictly under TypeScript compile-safe boundaries and lint-safe patterns (no `any`, `as any`, or `<any>` overrides). All database queries on soft-deletable tables apply Drizzle `isNull(deletedAt)` filters. All user-facing strings resolve from the i18n dictionary — zero hardcoded English strings exist in C05 code. All API error responses go through `jsonError(t, key, status)`; `new Response()` / raw `json({ error })` are absent from C05 API routes.

---

## 2. Implemented Modules

### 2.1 Notification Engine (Atomic)

- **[`src/lib/utils/mentions.ts`](file:///home/losses/Development/janbao/src/lib/utils/mentions.ts):** Lexical-JSON mention + plain-text extraction.
  - `extractMentions(contentJson)` recursively walks the Lexical node tree, collects text payloads, and matches `@username` tokens against the canonical username charset. Returns a de-duplicated username list.
  - `extractPlainText(contentJson, maxLen)` collapses the tree to a single-line preview for message inbox previews.
- **[`src/lib/server/db/notifications.ts`](file:///home/losses/Development/janbao/src/lib/server/db/notifications.ts):** Centralized dispatcher (RQ00-Backend §5.4).
  - `dispatchReplyNotifications` — on a new discussion reply, resolves and notifies (with per-category preference gating): mentioned users (`mention`), the discussion owner (`discussionReply || discussionComment`), thread participants (`participatedComment`), and bookmark subscribers (`bookmarkedDiscussionComment`). A user receives at most one notification per event (mention > owner > participant > bookmarker priority).
  - `dispatchMessageNotifications` — on a new private message, notifies the other participants (`privateMessage`). **PM `@mention` notifications are intentionally bypassed** so private content is never leaked outside the conversation (§5.4).
  - Both skip soft-deleted discussions/conversations and never self-notify the author.

### 2.2 Backend API Endpoints

- **[`/api/notifications` GET/PUT](file:///home/losses/Development/janbao/src/routes/api/notifications/+server.ts):** List notifications (newest first, `limit` query, capped at 100) and mark-as-read (by `ids` array or `{ all: true }`).
- **[`/api/messages/recent` GET](file:///home/losses/Development/janbao/src/routes/api/messages/recent/+server.ts):** N most recently active conversations with last-message preview + unread count (tooltip uses `limit=5`).
- **[`/api/messages` POST](file:///home/losses/Development/janbao/src/routes/api/messages/+server.ts):** Create a conversation (validates subject, ≥1 recipient, content ≤512 KiB, recipient existence) inside a transaction, inserts the author + recipients as participants and the first message, clears the composer draft, then dispatches PM notifications.
- **[`/api/users/search` GET](file:///home/losses/Development/janbao/src/routes/api/users/search/+server.ts):** Username prefix autocomplete (`q` param, max 10), excluding the caller and the System User. Powers `@mention`, recipient selection, and `ParticipantAdder`.
- **[`/api/drafts` DELETE](file:///home/losses/Development/janbao/src/routes/api/drafts/+server.ts) & [`/api/drafts/clear` POST](file:///home/losses/Development/janbao/src/routes/api/drafts/clear/+server.ts):** Delete a draft by `(contextType, contextId)` composite. `contextType` allowlist-validated.
- **[`/api/invitations` GET](file:///home/losses/Development/janbao/src/routes/api/invitations/+server.ts):** Lists the user's codes with dynamically-resolved status (`used` / `unused` / `expired`) and the redeeming username.
- **[`/api/invitations/request` POST](file:///home/losses/Development/janbao/src/routes/api/invitations/request/+server.ts):** Mints a 12-char unambiguous code (crypto-random) with 7-day expiry, enforcing the timezone-aware per-month `MONTHLY_INVITATION_LIMIT`.
- **[`/api/bookmarks` GET](file:///home/losses/Development/janbao/src/routes/api/bookmarks/+server.ts):** Paginated bookmarked-discussion list (added alongside the existing POST/DELETE).

### 2.3 Server Loaders & Actions

- **[`/messages/[id]/[[page=page]]` load + actions](file:///home/losses/Development/janbao/src/routes/messages/%5Bid%5D/%5B%5Bpage=page%5D%5D/+page.server.ts):** Participant-gated conversation view. Marks `conversationReads` and clears pending `message`-type notifications for the conversation on visit. Actions: `addParticipant` (participant-gated, target-existence checked, `onConflictDoNothing`), `post` (insert message + clear draft + dispatch notifications), `editMessage` (author-only content update — PMs are editable but never deleted, §6.5).
- **[`/messages/inbox` load](file:///home/losses/Development/janbao/src/routes/messages/inbox/+page.server.ts):** Paginated conversation list via the messages DAO.
- **[`/messages/new` load](file:///home/losses/Development/janbao/src/routes/messages/new/+page.server.ts):** Loads the composer draft and an optional `?recipient=` prefill (from the Active Users Wall).
- **[`/notifications` load](file:///home/losses/Development/janbao/src/routes/notifications/+page.server.ts):** Full notification list + `hasUnread` flag.
- **[`/bookmarks` load](file:///home/losses/Development/janbao/src/routes/bookmarks/+page.server.ts):** Paginated bookmarks.
- **[`/drafts` load](file:///home/losses/Development/janbao/src/routes/drafts/+page.server.ts):** Lists only `discussion` and `reply` drafts (filters out PM/activity drafts, §6.10).
- **[`/profile/comments/[userId]/[userSlug]` load](file:///home/losses/Development/janbao/src/routes/profile/comments/%5BuserId%5D/%5BuserSlug%5D/+page.server.ts):** Merged comments UNION query.
- **[`/profile/invitations` load](file:///home/losses/Development/janbao/src/routes/profile/invitations/+page.server.ts):** Invitations + monthly allowance + remaining count.
- **Discussion reply action (C03) — wired:** `src/routes/discussion/.../+page.server.ts` now invokes `dispatchReplyNotifications` after inserting a reply (previously no notifications were dispatched).

### 2.4 Data Access Objects (Atomic Backend)

- **[`dao/notifications.ts`](file:///home/losses/Development/janbao/src/lib/server/db/dao/notifications.ts):** `getNotifications` — batch-resolves source-user display info, discussion titles, and message→conversation links.
- **[`dao/messages.ts`](file:///home/losses/Development/janbao/src/lib/server/db/dao/messages.ts):** `getConversations` — sorts conversation ids by last-message time, paginates, then expands only the page's conversations (title / participant-count / latest-message / unread). Avoids N+1.
- **[`dao/bookmarks.ts`](file:///home/losses/Development/janbao/src/lib/server/db/dao/bookmarks.ts):** `getBookmarks` + `getBookmarksCount`.
- **[`dao/invitations.ts`](file:///home/losses/Development/janbao/src/lib/server/db/dao/invitations.ts):** `getInvitations` (status resolution) + `getMonthlyRequestCount`.
- **[`dao/comments.ts`](file:///home/losses/Development/janbao/src/lib/server/db/dao/comments.ts):** `getUserComments` — UNION-merges discussion replies and activity comments, sorted chronologically (§6.3). Exports `UserCommentItem`.

### 2.5 Shared Types (`src/lib/types/api.ts`)

Added: `ListOffsetOptions`, `NotificationItem`, `NotificationMarkReadBody`, `BookmarkListItem`, `ConversationListItem`, `MessageItem`, `ParticipantItem`, `MessageCreateBody`, `AddParticipantBody`, `PostMessageBody`, `UserSearchResult`, `DraftClearBody`, `DraftListItem`, `InvitationItem`.

### 2.6 Frontend Components (Atomic)

- **[`ParticipantAdder.svelte`](file:///home/losses/Development/janbao/src/lib/components/molecules/ParticipantAdder.svelte) (Molecule):** Debounced username autocomplete (queries `/api/users/search`), excludes already-selected ids, emits selected users. Reused by `/messages/new` and the `/messages/[id]` sidebar.
- **[`ActiveUsersWall.svelte`](file:///home/losses/Development/janbao/src/lib/components/molecules/ActiveUsersWall.svelte) (Molecule):** Fetches `/api/users/online` and renders an avatar grid; each avatar links to start a PM.
- **[`PrivateMessageWindow.svelte`](file:///home/losses/Development/janbao/src/lib/components/organisms/PrivateMessageWindow.svelte) (Organism):** Conversation stream + composer (image-upload disabled) + author-only inline editing. **No ConfirmationModal** — PMs are not deletable (§6.5).

### 2.7 Frontend Pages

- **[`/messages/inbox`](file:///home/losses/Development/janbao/src/routes/messages/inbox/+page.svelte):** Conversation index (preview, unread badges, pagination). Sidebar = Send Message button + Active Users Wall (§3.3.3).
- **[`/messages/new`](file:///home/losses/Development/janbao/src/routes/messages/new/+page.svelte):** Recipient chips + subject + editor; POSTs `/api/messages` then navigates to the new conversation.
- **[`/messages/[id]/[[page=page]]`](file:///home/losses/Development/janbao/src/routes/messages/%5Bid%5D/%5B%5Bpage=page%5D%5D/+page.svelte):** `PrivateMessageWindow` + participants sidebar with `ParticipantAdder` (`addParticipant` action) + top/bottom paginators.
- **[`/profile/comments/[userId]/[userSlug]`](file:///home/losses/Development/janbao/src/routes/profile/comments/%5BuserId%5D/%5BuserSlug%5D/+page.svelte):** Merged comments with contextual links (reply → discussion, comment → activity anchor). Owner/Visitor sidebar split.
- **[`/profile/invitations`](file:///home/losses/Development/janbao/src/routes/profile/invitations/+page.svelte):** Monthly allowance header + request button (disabled at limit) + status table.
- **[`/notifications`](file:///home/losses/Development/janbao/src/routes/notifications/+page.svelte):** Notification list with type-specific deep links + "Mark all as read".
- **[`/bookmarks`](file:///home/losses/Development/janbao/src/routes/bookmarks/+page.svelte):** Paginated bookmark list.
- **[`/drafts`](file:///home/losses/Development/janbao/src/routes/drafts/+page.svelte):** Draft list with contextual jump-links (`/post/discussion` for discussion drafts; ID-only discussion route for reply drafts).

### 2.8 Shared Helpers & i18n

- **[`constants.ts`](file:///home/losses/Development/janbao/src/lib/server/constants.ts):** Added `getMonthlyInvitationLimit`, `getForumTimezone`.
- **[`welcome.ts`](file:///home/losses/Development/janbao/src/lib/server/db/welcome.ts):** Refactored timezone-offset logic into a shared `getTzOffsetMinutes`, exported `DateBoundary`, and added `getTzMonthBoundaries` (timezone-aware current-month window) for the invitation monthly limit.
- **i18n (`en.json` + `zh-CN.json`):** Added `message.*`, `invitation.*`, `notification.*`, `comment.*`, `bookmark.myBookmarks/noBookmarks`, and merged `draft.*` page keys into the existing API-error `draft` section (see §3 codebase-health note).

---

## 3. Verification & Compliance Checklist

- **Type Check:** `bun run check` — 1041 files, **0 errors, 0 warnings**.
- **Lint:** `bun run lint` (prettier → eslint → similarity-ts) — **exit 0**, clean. similarity-ts type duplicates = **0** (`Found 0 type literals`, `No similar types found!`).
- **Strict Typing:** Zero occurrences of `any`, `as any`, or `as unknown as` across all C05 files.
- **Inline Types:** All request/response/DAO shapes use named interfaces or imported shared types. Zero inline type literals in type-argument position.
- **i18n Compliance:** Zero hardcoded English strings in C05 code; all API errors use `locals.t.*`, all UI uses `t.*` keys.
- **Error Convention:** All C05 API routes use `jsonError(t, 'key.path', status)`; no `new Response()` / raw `json({ error })`.
- **Soft Deletion Safety:** Conversation queries apply `isNull(conversations.deletedAt)`; reply/comment queries apply `isNull(replies.deletedAt)` / `isNull(activities.deletedAt)`; notifications cleared on visit use the user-scoped filter.

### Codebase-Health Fixes (surfaced by stricter checking, not introduced by C05 logic)

During this cycle, repo-wide stricter type-checking (the `no-inline-typing` rule extended to type arguments) surfaced two pre-existing latent type mismatches in committed-but-unmodified files. They blocked `bun run check`, so they were fixed with minimal, correct changes:

- **`DiscussionRow.svelte` `DiscussionReadHistory.lastReadAt`** — widened to `Date | string | number | null` to match the DAO `ReadHistory.lastReadAt: Date | null`.
- **`profile/edit/+page.server.ts`** — the page's load shadowed the layout's full `user` with a partial object; added the `id` and `avatarFileId` fields so the `UserInfoBlock` molecule receives a complete `UserInfoSummary`.

---

## 4. Audit & Quality History

_Audit rounds will be appended here as 5-agent independent reviews complete._

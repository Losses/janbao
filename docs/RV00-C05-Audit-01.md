# RV00-C05-Audit-01: Cycle 5 Audit - Round 1

**Method:** 5 independent full-scope audit agents dispatched in parallel. Each read all spec documents (RQ00-Backend, RQ00-Frontend, RQ00-Plan §Cycle 5, DV00-C05-Journal, CLAUDE.md) and every C05 source file, producing an independent PASS/FAIL/WARN assessment across correctness, security, soft-delete, i18n, error convention, spec compliance, type-safety, performance, and notification-correctness categories.

**Agent Verdicts:** A1 PASS-WITH-WARNINGS · A2 PASS-WITH-WARNINGS · A3 PASS-WITH-WARNINGS · A4 PASS-WITH-WARNINGS · A5 PASS-WITH-WARNINGS. **0 CRITICAL.**

---

## Consensus & High-Priority Findings

### MAJOR (real defects - fixed)

| ID   | Description                                                                                                                                                                                                                                                                                                   | Consensus            | Resolution                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | **Self-authored PMs inflate the author's own unread badge.** `/api/messages` POST and the `post` action insert a message but never seed/update `conversationReads.lastReadAt` for the sending user, so the inbox DAO counts the author's own message as unread until they re-open the thread.                 | A5 MAJOR             | Fixed: upsert `conversationReads` for the author with `lastReadAt = now` after insert, in both the create endpoint and the `post` action.            |
| F-02 | **`addParticipant` + `editMessage` actions miss the conversation soft-delete / scope guard.** Only the `post` action joins `conversations` with `isNull(deletedAt)`; the other two mutations do not, allowing writes against a soft-deleted (or out-of-scope) conversation.                                   | A2/A3/A4 MAJOR+MINOR | Fixed: both actions now inner-join `conversations` with `isNull(deletedAt)` (and `editMessage` scopes by `messages.conversationId`) before mutating. |
| F-03 | **Header tooltip molecules still render Cycle-2 mock data.** `NotificationTooltip`, `MessageTooltip`, `BookmarkTooltip` hardcode mock arrays and never consume the C05 `/api/notifications?limit=5`, `/api/messages/recent?limit=5`, `/api/bookmarks?limit=5` endpoints the spec §3.4 requires them to power. | A3 MAJOR             | Fixed: all three molecules now `$effect`-fetch their endpoint and render real items (avatars, relative dates, unread badges, "Show All" links).      |

### MINOR / WARN (fixed)

| ID   | Description                                                                                                                                        | Resolution                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| W-01 | `ActiveUsersWall.svelte` hardcoded English fallback `'Active Users'`.                                                                              | Dropped the fallback (key always resolves).                                                                                   |
| W-02 | `messages/new` recipient-chip remove button hardcoded `✕` + English `aria-label="remove …"`.                                                       | Added `message.removeRecipient` key (+Icon atom).                                                                             |
| W-03 | `ParticipantAdder.svelte` re-declared a local `UserSearchResult` identical to the shared type.                                                     | Imports `UserSearchResult` from `$lib/types/api`.                                                                             |
| W-04 | `/bookmarks` page rendered `t.message.startedBy` ("Started by") - semantic mismatch.                                                               | Added `bookmark.startedBy` key to both dictionaries.                                                                          |
| W-05 | `draft.fieldsRequired` text says "contextType and contentJson" but the clear/delete endpoints need `contextType + contextId`.                      | Added `draft.contextFieldsRequired`; clear/delete endpoints use it.                                                           |
| W-06 | `VALID_CONTEXT_TYPES` array duplicated across 3 draft route files.                                                                                 | Hoisted to `src/lib/server/constants.ts` (`DRAFT_CONTEXT_TYPES`).                                                             |
| W-07 | `/api/users/search` used raw `sql\`... != ...\``while`ne` was imported unused.                                                                     | Uses `ne(users.id, user.id)`.                                                                                                 |
| W-08 | `profile/comments` loader had a dead `if (userSlug !== expectedSlug) {}` no-op stub.                                                               | Removed.                                                                                                                      |
| W-09 | `getUserComments` was an unbounded fetch (no limit).                                                                                               | Added a defensive `COMMENT_LIST_LIMIT` (500) cap to each UNION leg.                                                           |
| W-10 | `/drafts` loader was an unbounded fetch.                                                                                                           | Added a defensive `LIMIT` cap.                                                                                                |
| W-11 | `getConversations` unread-count computation loaded every message of each page conversation into JS.                                                | Replaced with a grouped SQL `COUNT(*) ... GROUP BY conversationId` over messages newer than each conversation's `lastReadAt`. |
| W-12 | `/api/invitations/request` had an unhandled PK-collision path (random 12-char code, no `onConflictDoNothing`).                                     | Added `onConflictDoNothing` + bounded retry loop.                                                                             |
| W-13 | `getUserComments` activity-comment branch did not filter soft-deleted _parent_ activities.                                                         | Self-joins `activities` on `parentActivityId` with `isNull(parent.deletedAt)`.                                                |
| W-14 | `welcome.ts` `getTzBoundaries` (closed `end`) vs `getTzMonthBoundaries` (half-open `end`) shared the `DateBoundary` type with ambiguous semantics. | Documented each producer's end-semantics in JSDoc (behavior unchanged - the C05 monthly-limit consumer is already correct).   |
| W-15 | Inline type-literal casts: `messages/new` `prefillRecipient` inline shape; `/api/bookmarks` POST `as { discussionId: string }`.                    | `prefillRecipient` typed as `UserSearchResult \| null`; extracted `BookmarkToggleBody`.                                       |
| W-16 | `/api/users/search` + tooltip molecules: t-dict `as Record<string,string>` casts (pervasive existing pattern).                                     | Left consistent with C02–C04 convention (ActivityRow et al.); not a lint failure.                                             |

### Excluded (out of C05 scope / user WIP)

| ID  | Description                                                                                                                                        | Disposition     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| -   | A5 C05-02: `/profile/onlineNow` route-folder casing rename is **the user's own in-progress change** for route-style consistency, not a C05 defect. | Left untouched. |

---

## Strengths (consensus)

- Notification dispatcher (`notifications.ts`) correctly implements §5.4: per-category preference gating (owner = `discussionReply || discussionComment`), at-most-one-notification-per-event priority (mention > owner > participant > bookmarker, first-write-wins), self-exclusion, soft-delete short-circuit, and **PM `@mention` bypass** (private content never leaks).
- Authorization/IDOR gates are sound across all C05 routes and actions; PM detail load orders 401 → 404 → 403.
- Soft-delete filters applied on all conversation/discussion/reply/activity reads.
- Visit-marks-read works for both `/discussion/:id` (by `discussionId`) and `/messages/:id` (by conversation message ids), user-scoped.
- Draft cleared on every successful create/post/reply; atomic PM creation in a transaction.
- `bun run check` = 0 errors/0 warnings (1041 files); `bun run lint` = exit 0; i18n parity exact (257 = 257 keys, zero duplicates); zero `any`/`as any`/`as unknown`.

---

## Cycle 5 Scope Completeness

All RQ00-Plan §4 (Cycle 5) deliverables present and wired: notification engine + PM bypass, `/profile/comments` UNION, `/api/drafts` DELETE + `/api/drafts/clear`, `/api/invitations` GET + `/api/invitations/request` (monthly limit), `/messages/[id]` read-marking + `addParticipant`, `/api/notifications` GET/PUT, `/api/bookmarks` GET, `/api/messages/recent` GET, all DAOs, all 8 frontend pages, `ParticipantAdder` / `ActiveUsersWall` / `PrivateMessageWindow`. **Round 1 closes the one scope gap (tooltip mock-data wiring, F-03) plus all consensus hardening items.**

**Verification:** `bun run check` + `bun run lint` re-run after fixes.

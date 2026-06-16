# RV04-C05-Audit-01: DV04 Cycle 5 - Round 1 Audit

**Date:** 2026-06-16
**Cycle:** C05 - User Dashboards (PM / Notifications / Bookmarks / Activity)
**Method:** 5 independent sub-agents, each performing the full un-roled audit of the C05 scope. No roles assigned. Reports consolidated below.

**Round 1 Verdicts:** 1× PASS (Agent 1), 4× PASS_WITH_NOTES (Agents 2, 4, 5), 1× FAIL (Agent 3 - escalated two issues to CRITICAL).
**Consolidated consensus: FAIL** - several real carry-over-class MAJORs plus the lone-CRITICAL pair (calibrated below).

---

## 1. Severity calibration - the lone "CRITICAL" pair (Agent 3)

Agent 3 rated two directed-activity issues CRITICAL: (C5-1) the `/activity` public feed shows directed (`recipientId` set) activities to everyone; (C5-2) `/api/activities/comments` has no parent-visibility check. Verified against the code; **calibrated to non-defects (intended public-wall design)**:

- The `/activity` feed (`src/routes/activity/+page.server.ts:74-90, 151-154`) **deliberately resolves and renders `recipientDisplayName`/`recipientUsername`** for directed activities. If directed activities were private, that rendering would be dead code. Its presence means a directed activity is a **public wall post** (recipientId = "posted on X's wall"), not a private message - PMs are the separate `conversations`/`messages` system. This matches Vanilla's activity-feed semantics (the project's origin).
- Consequently comments on a public wall post being open to all viewers is **consistent** with the public-wall design, not a leak.
- `search.ts`'s `recipientId` filter is a stricter **search-scope** choice (don't surface wall posts in third-party search results), not a global privacy rule.

Therefore **C5-1 and C5-2 are not fixed** - they are intended behavior. (If the product instead wants directed activities private, that is a separate product change, not a C05 defect.) Documented with rationale.

---

## 2. Findings (deduplicated, with finders)

### MAJOR / MINOR (fixed this round)

- **C5-3 (Agents 1, 2, 3, 4, 5 - unanimous):** `/api/bookmarks` GET called `getBookmarks` with no `readableCategorySlugs` filter (the `/bookmarks` page loader does pass it). Bookmarks in an enabled-but-read-revoked category surfaced via the tooltip/direct API. Fix: the GET now resolves `getReadableCategorySlugs(resolveGroupSlug(user))` and passes the filter (mirroring the page loader, with the `['__none__']` empty-set sentinel).
- **C5-4 (Agents 2, 3, 4, 5):** notification discussion-title resolution (`dao/notifications.ts`) used a bare `inArray(discussions.id)` with no `isNull(deletedAt)` and no categories JOIN - stale titles for soft-deleted / now-disabled-category discussions leaked into the notification list. Fix: the resolution query now JOINs `categories` and filters `isNull(discussions.deletedAt)` + `isNull(categories.disabledAt)`; filtered-out notifications render a null title (UI already null-guards).
- **C5-5 (Agents 1, 3, 5 + Agent 2):** `POST /api/messages` filtered recipients only by `id !== user.id` (not `id > 0`), so a crafted request could open a conversation with the seeded system/ghost/bootstrap sentinels. Fix: added `id > 0` (parity with `addParticipant`, which already had it).
- **C5-6 (Agents 2, 3):** `PUT /api/notifications` discrete-id path filtered `typeof id === 'string'` while `NotificationMarkReadBody.ids` is typed `number[]` - the branch was dead/broken for any spec-compliant caller (latent only because the UI sends `{all:true}`). Fix: filter `typeof id === 'number'`.
- **C5-7 (Agent 3):** the messages `[id]` `post` action computed the destination page with `getPaginationLimit(undefined)` instead of `platform?.env`, so an env-configured `PAGINATION_LIMIT` would land the redirect on the wrong page. Fix: pass `platform?.env`.
- **C5-8 (Agents 4, 5):** `addParticipant` had no cap on the number of `userId` entries (N+1 existence checks + inserts). Fix: capped at `MAX_ADD_PARTICIPANTS = 20`.

### Carry-overs (documented, accepted)

- **C5-co1 (C01→C05):** `appendJoinedMember` daily-rollup TOCTOU - no DB uniqueness on (isJoined, day); two concurrent same-day first-signups could insert a duplicate rollup row. **Cosmetic only** (`activity_joins` PK preserves membership; only a duplicate feed entry), rare (concurrent first-of-day signups), and needs a generated-column + migration to fix properly. Accepted.
- **C5-co2 (C04→C05):** activity comments dispatch no notification (wall replies don't notify) - **accepted design** (consistent with the public-wall model; not a defect). If comment notifications are wanted, that is a feature request.
- **C5-co3:** mention may notify a user who lacks read access to the discussion's category (the link 403s for them; mention is an explicit authoring act). Accepted.
- **C5-co4 (Agent 5):** `getConversations` uses `MAX(createdAt)` for sorting (epoch-seconds, correct) but reads the typed column for display - fragile pattern (the documented Drizzle date-aggregate gotcha), no live defect. Accepted.
- **C5-co5 (Agent 5):** messages `[id]` page hand-rolls page parsing instead of `parseDiscussionPageFromPath` (consistency; functionally correct). Accepted.
- **C5-co6 (Agent 4):** `/api/activities` + `/api/activities/comments` parse JSON without try/catch (malformed body → 500 not 400). Robustness nit. Accepted.

---

## 3. Carry-over / pre-known verification (all 5 agents)

- **PM participant authorization: sound (5/5)** - `load`/`post`/`addParticipant`/`editMessage` all gate on `conversationParticipants.userId === user.id` JOINed with `isNull(conversations.deletedAt)`; no IDOR on `[id]`; `editMessage` own-only.
- **Notification read-marking: own-only (5/5)** - `PUT` scopes every update `eq(notifications.userId, user.id)`; GET user-scoped.
- **Bookmark POST/DELETE: own-only + disabled-category-aware (5/5)** - POST verifies non-deleted + non-disabled + `canRead`; DELETE scoped to `userId`.
- **Conversation soft-delete: enforced on every read path.**
- **Self-mention excluded** in notification dispatch.
- **C04 wall-reply carry-over: RESOLVED** - `profile_comment` notification fires only for top-level directed activities; comments create none.

---

## 4. Round 1 Action Plan

Fix **C5-3** (bookmarks GET filter) → **C5-4** (notification title filter) → **C5-5** (messages `id > 0`) → **C5-6** (mark-read type) → **C5-7** (post pagination env) → **C5-8** (addParticipant cap). Carry over C5-co1..co6 and document the C5-1/C5-2 public-wall calibration. Run `bun run check` + `bun run lint`. Then re-audit (Round 2).

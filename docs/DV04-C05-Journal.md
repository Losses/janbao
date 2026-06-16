# DV04-C05-Journal: Cycle 5 Audit Journal - User Dashboards (PM / Notifications / Bookmarks / Activity)

## Cycle 5: User Dashboards (PM / Notifications / Bookmarks / Activity)

**Date:** 2026-06-16
**Status:** ✅ CLOSED - 5/5 unconditional PASS (Round 2)

---

## 1. Scope

PM, notifications, bookmarks, and the activity square/feed:

- PM: `src/routes/messages/{inbox,new,[id]/[[page=page]]}/+page.server.ts` (actions `addParticipant`, `post`, `editMessage`); `src/routes/api/messages/+server.ts`; `src/routes/api/messages/recent/+server.ts`
- Notifications: `src/routes/notifications/+page.svelte` + `src/routes/api/notifications/+server.ts` (GET/PUT); DAO `src/lib/server/db/dao/notifications.ts`
- Bookmarks: `src/routes/bookmarks/+page.{server,svelte}` + `src/routes/api/bookmarks/+server.ts` (GET/POST/DELETE); DAO `src/lib/server/db/dao/bookmarks.ts`
- Activity: `src/routes/activity/+page.server.ts` + `src/routes/api/activities/{+server,comments/+server}.ts`; joined-activity rollup `src/lib/server/db/joined-activity.ts`
- DAO: `src/lib/server/db/dao/messages.ts`; dispatch helpers in `src/lib/server/db/notifications.ts`

---

## 2. Method

Per DV04-Plan §2: 5 independent sub-agents run the same full un-roled audit; advance only on 5/5 unconditional PASS. Gate each round: `bun run check` 0/0 + `bun run lint` exit 0.

---

## 3. Audit Round 1 - 2026-06-16

Consolidated → [RV04-C05-Audit-01.md](./RV04-C05-Audit-01.md).
**Verdicts:** 1× PASS (Agent 1), 4× PASS_WITH_NOTES, 1× FAIL (Agent 3, two CRITICALs). **Consensus: FAIL.**

**Severity calibration:** Agent 3's two CRITICALs (`/activity` feed shows directed activities publicly; `/api/activities/comments` no parent-visibility check) were verified against the code and **calibrated to non-defects** - the feed deliberately renders `recipientDisplayName`/`recipientUsername` for directed activities, so a directed activity is a **public wall post** (recipientId = wall, not a private message); comments being open to all viewers is consistent with that public-wall design. `search.ts`'s recipientId filter is a stricter search-scope choice, not a global privacy rule. Not fixed; documented with rationale.

**Issues found and fixed (Round 2 fixes):**

- **MAJOR (5/5)** - `/api/bookmarks` GET passed no `readableCategorySlugs` filter (the page loader did). Fix: GET now resolves + passes the filter (mirroring the page loader).
- **MAJOR (4)** - notification discussion-title resolution leaked titles of soft-deleted / disabled-category discussions. Fix: resolution query now JOINs categories + filters `isNull(deletedAt)`/`isNull(disabledAt)`; filtered-out rows render a null title.
- **MAJOR (3)** - `POST /api/messages` recipients filtered only by `id !== user.id` (not `id > 0`), allowing DMs to the seeded sentinels. Fix: added `id > 0` (parity with `addParticipant`).
- **MAJOR (2)** - `PUT /api/notifications` discrete-id path filtered `typeof id === 'string'` against a `number[]` type (dead branch). Fix: `typeof id === 'number'`.
- **MINOR** - messages `[id]` `post` action used `getPaginationLimit(undefined)` instead of `platform?.env`. Fix: pass `platform?.env`.
- **MINOR** - `addParticipant` had no cap on userIds (N+1 + no cap). Fix: capped at `MAX_ADD_PARTICIPANTS = 20`.

**Carry-overs (documented, accepted):** `appendJoinedMember` daily-rollup TOCTOU (cosmetic, rare; needs generated-column migration); activity-comment notification silence (accepted public-wall design); mention-to-unreadable-category notification (mention is explicit; link 403s); `MAX(createdAt)` sort aggregate fragility (no live defect); `[id]` hand-rolled page parsing (consistency); activities JSON parse no try/catch (robustness). C5-1/C5-2 (public-wall design) calibrated non-defects.

**Verified intact (5/5):** PM participant authorization (no IDOR, own-only edit, soft-delete enforced); notification read-marking own-only; bookmark POST/DELETE own-only + disabled-category-aware; self-mention excluded; C04 wall-reply carry-over resolved.

**Verification after Round 2 fixes:** `bun run check` 0/0; `bun run lint` exit 0.

**Status:** Round 2 fixes applied and verified. Proceeding to Round 2 re-audit to seek 5/5 unconditional PASS.

---

## 4. Audit Round 2 - 2026-06-16 (FINAL)

Consolidated → [RV04-C05-Audit-02.md](./RV04-C05-Audit-02.md).
**Verdicts:** 5× PASS (Agents 1, 2, 3, 4, 5 - all unconditional). All six Round-1 fixes CONFIRMED; no regressions; gate green (each agent re-ran `bun run check` 0/0, `bun run lint` exit 0).

**C5-1/C5-2 calibration confirmed by all 5 agents** - including Agent 3 (the Round-1 FAIL agent), which retracted its CRITICALs after re-examining the evidence: `ActivityRow.svelte` renders "author → recipient" as a deliberate wall-post affordance; the profile page surfaces directed activities publicly; PMs are a fully separate system; `search.ts`'s recipientId filter is a search-scope choice. Directed activities are public wall posts by design.

Non-actionable observations: `/api/activities` POST `recipientId` doesn't API-block GHOST sentinel (cosmetic, public-wall); `messages/new` prefill accepts sentinel ids for display only (creation blocked by `id > 0`). Both accepted.

**Status: ✅ UNANIMOUS PASS - C05 audit loop closed.** All five agents consider Cycle 5 (User Dashboards) complete and clean. C05 converged in 2 rounds.

**Cycle 5 complete. Advancing to Cycle 6 (Admin & Permissions - fresh full re-audit).**

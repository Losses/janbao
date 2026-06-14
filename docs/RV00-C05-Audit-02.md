# RV00-C05-Audit-02: Cycle 5 Audit  - Round 2

**Method:** 5 independent full-scope audit agents dispatched in parallel. Each verified the Round-1 fixes (F-01/F-02/F-03, W-11/W-12/W-13) and re-audited the entire C05 codebase across all categories.

**Agent Verdicts:** R2-A1 PASS · R2-A2 PASS · R2-A3 PASS-WITH-WARNINGS · R2-A4 PASS-WITH-WARNINGS · R2-A5 PASS-WITH-WARNINGS. **0 CRITICAL, 0 MAJOR, 0 FAIL.**

**Round-1 fix verification (unanimous):** F-01, F-02, F-03, W-11, W-12, W-13 all **VERIFIED-CORRECT, no regressions**.

---

## Round-2 Findings (all MINOR/WARN hardening  - fixed)

| ID      | Description                                                                                                                                                                                                                 | Consensus             | Resolution                                                                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-F-01 | `getConversations` latest-message detail join (`eq(messages.createdAt, maxAt)`) returns non-deterministic preview/author when two messages share a `createdAt` millisecond (realistic under D1 second-granularity defaults) | A2/A3/A5 (3 agents)   | Select includes `messages.id`; the latest map keeps the row with the **largest id** per conversation (deterministic tie-break)                    |
| R2-F-02 | `/messages/[id]` visit-marks-read fetched **all** message ids of the conversation into JS then built an unbounded `IN (...)` clause (SQLite bind ceiling)  - diverged from the discussion-side single-predicate pattern      | A2/A3                 | Replaced with a single SQL `UPDATE ... WHERE messageId IN (SELECT id FROM messages WHERE conversationId = ?)`  - no id round-trip, no bind ceiling |
| R2-F-03 | `PrivateMessageWindow` composer `contextId` derived from `messages[0]?.conversationId ?? ''`, collapsing to `''` (and losing the draft) on a zero-message page                                                              | A5 (+ R1 W-02)        | Added an explicit `conversationId` prop sourced from `data.conversation.id`; composer uses it directly                                            |
| R2-F-04 | `isEligible(category, pref)` param used an inline object-type literal that bypassed the no-inline-typing AST selector (wrapped in a union)                                                                                  | A3                    | Extracted a named `NotificationPreferenceFields` interface                                                                                        |
| R2-F-05 | `messages/new` `SelectedRecipient` and `messages/[id]` `Participant` local interfaces duplicated the shared `UserSearchResult` / `ParticipantItem` types                                                                    | A3                    | Reuse the shared types                                                                                                                            |
| R2-F-06 | `getConversations` unread count includes the author's **own** messages (relies on every writer advancing `lastReadAt`)                                                                                                      | A5 (defense-in-depth) | Added `ne(messages.authorId, userId)` to the unread-count predicate so the contract is self-contained                                             |
| R2-F-07 | `ActiveUsersWall` empty state rendered a hardcoded `"-"` glyph                                                                                                                                                              | A2                    | Replaced with a neutral i18n-resolved empty state (no literal)                                                                                    |
| R2-F-08 | `/api/notifications` PUT discrete-`ids` path accepted an unbounded array (large `IN`)                                                                                                                                       | A2                    | Capped `ids` to `MAX_MARK_READ_IDS` (500)                                                                                                         |
| R2-F-09 | `/profile/invitations` `requestCode` swallowed server errors silently                                                                                                                                                       | A3                    | Surfaces `result.error` in an alert message                                                                                                       |

### Accepted as-is (defensible / out of scope)

- Invitations header shows _remaining_ (keyed `thisMonthAllowance` with the word "available") rather than the raw limit  - semantically correct ("available" = remaining) and drives the disabled-button state; spec §6.14 wording is ambiguous. (A4)
- `editMessage` returns `t.message.conversationNotFound` for the empty-result branch  - acceptable copy precision; client behavior unchanged. (A4)
- Draft `contextId` empty-string contract matches the autosave convention (`discussion` drafts use `contextId='new'`/`''`); intentional and user-scoped. (A4)
- `/api/messages` recipient-existence check has no soft-delete filter  - the `users` table has no `deletedAt` column today; noted for a future user-soft-delete cycle. (A5)
- Tooltip molecules latch `loaded=true` (no auto-refetch on reopen)  - cosmetic; the tooltip re-fetches on next open. (A5)
- `notificationTypeFor` collapses participant + bookmarker categories to `'discussion_comment'`  - internally consistent; no spec text requires distinct labels. (A1)

---

## Strengths (consensus)

Round-2 agents independently confirm: notification dispatcher (§5.4) correct incl. PM `@mention` bypass; authz/IDOR sound (401→404→403 ordering, participant-gated mutations, user-scoped PUT/DELETE); soft-delete filters on every read; `bun run check` 0/0 (1041 files); `bun run lint` exit 0 (similarity-ts "No similar types found!"); i18n parity exact (260 = 260 keys, zero duplicate keys); zero `any`/`as any`/`as unknown`; all API errors via `jsonError`; drafts cleared on every create/post/reply; transactional PM creation; timezone-aware monthly invitation limit.

## Cycle 5 Completeness

All RQ00-Plan §4 (Cycle 5) deliverables present, wired, and verified. Round 2 found no scope gaps and no correctness/security/spec defects  - only polish.

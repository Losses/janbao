# RV04-C05-Audit-02: DV04 Cycle 5 - Round 2 Audit (FINAL)

**Date:** 2026-06-16
**Cycle:** C05 - User Dashboards (PM / Notifications / Bookmarks / Activity)
**Method:** 5 independent sub-agents re-audited the C05 scope after Round 1 fixes, each performing the full un-roled audit. Reports consolidated below.

**Round 2 Verdicts:** **5× PASS** (unconditional) - Agents 1, 2, 3, 4, 5. All six Round-1 fixes CONFIRMED; no regressions; no new actionable defects.
**Consolidated consensus: UNANIMOUS PASS. Audit loop closed.**

---

## 1. Final fix verification (all 5 agents)

- **C5-3**: `/api/bookmarks` GET now resolves + passes `readableCategorySlugs` (mirroring the page loader, `['__none__']` sentinel). Tooltip shape unchanged → not broken.
- **C5-4**: `dao/notifications.ts` discussion-title resolution JOINs `categories` + filters `isNull(deletedAt)`/`isNull(disabledAt)`; filtered-out rows render a null title (UI null-guards). No legitimate title dropped.
- **C5-5**: `POST /api/messages` recipient filter is `typeof id === 'number' && id > 0 && id !== user.id` (blocks sentinels; parity with `addParticipant`).
- **C5-6**: `PUT /api/notifications` discrete-id path filters `typeof id === 'number'` (matches the `number[]` type; branch no longer dead).
- **C5-7**: messages `[id]` `post` action uses `getPaginationLimit(platform?.env)`.
- **C5-8**: `addParticipant` caps `userIds` at `MAX_ADD_PARTICIPANTS = 20`.
- **Verification gate GREEN** - every agent re-ran `bun run check` (0/0) and `bun run lint` (exit 0).

## 2. C5-1/C5-2 calibration - confirmed by all 5 agents

The Round-1 lone-CRITICAL pair (`/activity` feed shows directed activities publicly; `/api/activities/comments` no parent-visibility check) was calibrated as **intended public-wall design**. Round 2 corroborated this with multiple independent lines of evidence, and **Agent 3 (the Round-1 FAIL agent) conceded and retracted its CRITICALs**:

- `ActivityRow.svelte` deliberately renders "author → recipient" with a profile link (the canonical wall-post affordance).
- The profile page surfaces directed activities (`recipientId = userId`) to all viewers - wall semantics, not mailbox.
- PMs are a fully separate `conversations`/`messages`/`conversationParticipants` system with participant gates.
- `search.ts`'s stricter `recipientId` filter is a search-scope choice, not a global privacy rule.

Directed activities are public wall posts by design; the comments endpoint being open is consistent. Not a defect.

## 3. Findings raised in Round 2

**None actionable.** All five agents returned unconditional PASS. Non-actionable observations:

- Agent 3: `/api/activities` POST `recipientId` validation doesn't API-block `GHOST_USER_ID` (-2); given public-wall semantics this is a cosmetic nit (not a privacy defect). Accepted.
- Agent 4: `messages/new` recipient prefill accepts sentinel ids for display; conversation creation is still blocked by the `id > 0` filter. Cosmetic. Accepted.

## 4. Carry-overs (final, accepted for C05)

1. `appendJoinedMember` daily-rollup TOCTOU (cosmetic; rare; needs generated-column migration).
2. activity-comment notification silence (accepted public-wall design).
3. mention may notify a user who lacks category read (mention is explicit; link 403s).
4. `getConversations` `MAX(createdAt)` sort aggregate fragility (no live defect; documented gotcha).
5. `[id]` page hand-rolled page parsing (consistency; functionally correct).
6. activities JSON parse no try/catch (robustness nit).
7. `/api/activities` POST `recipientId` doesn't API-block GHOST sentinel (cosmetic, public-wall).

## 5. Round 2 Conclusion

**DV04 Cycle 5 (User Dashboards) is unanimously considered complete and clean.** All five agents rendered an unconditional PASS; the gate is green; the four MAJORs + two MINORs from Round 1 are fixed and re-verified; PM participant authorization, notification own-only read-marking, bookmark own-only + readable-category filtering, and soft-delete propagation all hold. The lone-CRITICAL pair was correctly calibrated as intended public-wall design. **C05 advances. Audit loop closed.**

---

## Appendix: C05 fix summary (Round 1)

- **C5-3 (MAJOR):** `/api/bookmarks` GET passes `readableCategorySlugs` (parity with the page loader).
- **C5-4 (MAJOR):** notification discussion-title resolution JOINs `categories` + filters soft-delete/disabled.
- **C5-5 (MAJOR):** `POST /api/messages` recipients require `id > 0` (sentinel block; parity with `addParticipant`).
- **C5-6 (MAJOR):** `PUT /api/notifications` discrete-id filter `typeof id === 'number'`.
- **C5-7 (MINOR):** messages `[id]` `post` pagination uses `platform?.env`.
- **C5-8 (MINOR):** `addParticipant` capped at `MAX_ADD_PARTICIPANTS = 20`.

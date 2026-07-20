# RV20-C05b2 - Audit Round 94

Result: **A FAIL (1 concern); B FAIL (2 concerns).** Counter stays **0/5**. The
fourth OPEN-scoped round. Both auditors independently swept the id-0 and
draft-coercion classes BROADLY and caught THREE sibling sites the R93 fix had
missed (R93's horizontal grep was too narrow: `id > 0` did not match
`lastReplyAuthorId > 0`, `n > 0`, or the `/drafts/clear` sibling of the `/save`
hardening). All three fixed. This validated the binding horizontal-check rule and
exposed a process defect in the orchestrator's R93 close-out (handing the fixer a
narrow pre-computed site list instead of requiring an independent broad sweep);
the fixer prompt is now strengthened to require independent class-wide
enumeration (see `audit-search-for-similar-bugs` memory, updated 2026-07-19).

## B's findings (the id-0 class siblings, FIXED)

1. **`writeList`'s `lastReplyAuthorId` filter dropped id 0**
   (`src/lib/offline/passthrough.ts:307-310`, concern, FIXED). The R93 fix
   converted `editorFromThread` (L199) and `upsertUsers` (L278) in the SAME file
   to `isRealUserId` but missed the `writeList` lastReplyAuthor check three lines
   away: `item.lastReplyAuthorId != null && Number.isFinite(...) && ... > 0` ->
   `isRealUserId(item.lastReplyAuthorId)`. The bootstrap admin as a last-replier
   was dropped from the cached authors list (no user-visible regression today only
   because the offline list view happens not to render last-reply attribution,
   but it is the exact class and inconsistent with the two siblings in the file).
2. **`backfillUserIds` parser dropped id 0** (`src/routes/api/sync/content/
+server.ts:37`, concern, FIXED). `.filter((n) => Number.isFinite(n) && n > 0)`
   -> `.filter((n) => isRealUserId(n))` (import added). The client
   `backfillMissingUsers` correctly used `isRealUserId` (includes 0), but the
   server re-filtered with `n > 0` and stripped id 0, so the admin was omitted
   from backfill responses.

Independent orchestrator sweep (broad patterns: `> 0 | <= 0 | < 1 | !== 0 | >= 1`
plus truthy `XId &&` across every user-id-bearing name and short filter params):
the only remaining hits are non-user-id (pagination/limit/retention, scrollTop,
dt/velocity, unread counts, config-number parsers such as `constants.ts:53`). The
id-0 user-id filter class is now fully closed.

## A's finding (the draft-coercion sibling, FIXED)

**`POST /api/drafts/clear` lacked the contextId coercion (concern, FIXED).** R93
hardened `POST /api/drafts/save` to coerce `contextId` to a finite integer (so a
non-numeric `'new'` cannot be stored as TEXT in the INTEGER-affinity
`drafts.context_id` column and bypass the integer-keyed load/clear queries). The
sibling `/api/drafts/clear` only did `body.contextId ?? 0` (no coercion for a
non-null/undefined value), so it had the same silent-data-loss gap. (`DELETE
/api/drafts` already coerced via `Number() || 0`.)
Structural fix (not copy-paste): extracted a shared pure helper
`normalizeDraftContextId(value: unknown): number` in
`src/lib/server/utils/drafts.ts`; BOTH `/save` and `/clear` now call it. Added a
preventive unit test `src/lib/server/utils/drafts.test.ts` (7 tests / 16
assertions: `0 -> 0`, positive int passthrough, `'new'`/strings -> 0,
null/undefined -> 0, NaN/Infinity -> 0, float passthrough, non-number types ->
0). The single helper + test locks the class so no future drafts endpoint can
reintroduce it. (The endpoint has no client caller today, drafts are cleared via
direct DB calls, but the gap is the same defense-in-depth class R93 closed at
`/save` and an obvious sibling miss.)

## Process fix (orchestrator)

The R93 fixer was handed a narrow pre-computed site list (from an
`id > 0`-only grep) and fixed exactly it; the orchestrator did not require the
fixer to independently re-enumerate the class, nor cross-check the enumeration.
R94's auditors (whose prompt already required the horizontal sweep) caught the
misses. Corrections applied: (1) the fixer prompt now BINDS the fixer to
independently grep the whole class with BROAD patterns, enumerate every instance,
fix all, and report the complete classified list; (2) the orchestrator
cross-checks that enumeration; (3) the `audit-search-for-similar-bugs` memory was
updated with the concrete failure mode (narrow patterns miss same-class
siblings with other variable names; never hand the fixer a pre-computed list).

## Gate outputs (post-fix, 2026-07-19, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun test src/lib/server/utils       7 pass / 0 fail (new drafts helper test)
$ bun run test:e2e                    210 passed / 0 flaky (exit 0, 9.1m)
```

R95 audits this state (open-scoped prompt).

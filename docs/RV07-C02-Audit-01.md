# RV07 C02 Audit - Round 1

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff 4b03112..HEAD` (commit b03c0f1). Plan: `docs/DV07-Plan.md`.
See [[dv04-audit-loop]].

## Verdict

**2/5 UNCONDITIONAL_PASS, 3/5 PASS_WITH_NOTES** → not 5/5. Fix and re-audit.

| Agent | Start file             | Verdict            |
| ----- | ---------------------- | ------------------ |
| 1     | sync-orchestrator.ts   | UNCONDITIONAL_PASS |
| 2     | evict.ts + idb.ts      | PASS_WITH_NOTES    |
| 3     | manifest.ts + prefs.ts | PASS_WITH_NOTES    |
| 4     | integration skeptic    | PASS_WITH_NOTES    |
| 5     | types.ts + prefs.ts    | UNCONDITIONAL_PASS |

Gates: `bun run check` 0/0; `bun run lint` exit 0 (0 type-dupes); `bun test` 33/33
(manifest 11 + carry-over 22).

## MAJOR findings (must fix)

- **[CRITICAL, A4] Eviction transaction omits `replyCacheManifest`.**
  `evict.ts` opens `db.transaction('rw', db.discussions, db.replies,
db.readStateMerged, …)` but the body calls `db.replyCacheManifest.delete(id)`.
  Dexie raises _Table not part of transaction_ and **rolls the whole txn back** →
  eviction silently never commits once any row qualifies. Fix: add
  `db.replyCacheManifest` to the transaction's store array.
- **[MAJOR, A2/A3] front/bookmark remove-delta always empty.** `applyReasonSets`
  reads `frontPageSnapshot`/`bookmarksSnapshot` from syncMeta as the "prior" set,
  but the per-page loop already overwrote them with the current sync's value →
  `prior === current` → the remove-delta is permanently empty. A discussion that
  scrolls off the front page or is un-bookmarked keeps its `front`/`bookmark`
  reason forever and is never evicted (defeats reason-set eviction for those two
  reasons). The `curated:*` diff is correct (it mirrors prior separately) — apply
  the same pattern to front/bookmark: capture the prior snapshot BEFORE the page
  loop writes, and diff against that.

## MINOR findings (fix alongside)

- **[A3/A4/A5] `computeCachedRanges` over-cap gate uses `totalPages*pageSize`**
  instead of actual `commentCount` → over-estimates near the 1000 boundary → may
  split early (phantom gap) with non-default `PAGINATION_LIMIT`. Fix: pass
  `commentCount` into `computeCachedRanges` and gate the split on the real count.
  Update `manifest.test.ts`.
- **[A1/A4] `populateReplyManifests` only covers curated∪front∪bookmark** — a
  `'read'`-only row (C04) won't get a manifest until it re-enters a curated set.
  Acceptable for C02 (passthrough is C04); log as **CO-C02-1** for C04 to write
  the manifest on passthrough.
- **[A5] `REPLY_CAP`/`REPLY_CAP_HALF` duplicated** client (`manifest.ts`) vs
  server (`db/dao/sync.ts`) — log as **CO-C02-2**; dedupe into a shared `$lib`
  module if trivial, else carry to a later cycle.
- **[A4] journal overstatement** — `!enabled` path DOES write additive manifest
  rows / populate front-bookmark reasons (server request shape is byte-identical
  to DV06, but "no writes" overstates). Correct the journal wording.

## Confirmed correct (all 5)

- `!enabled` server request = DV06 (`categories=` + `depth=firstLast`); additive
  IDB writes don't alter observable DV06 behavior (new store read only by the new
  `replyGaps` path, which falls back to empty).
- IDB v3→v4 additive (new `replyCacheManifest` store; `reasons`/`readUpdatedAt`
  optional → in-place upgrade; existing stores/indexes unchanged).
- Reason-set update for `curated:*` (union on members, removal of lapsed, prior
  mirror diff); `read` reason never touched by orchestrator.
- Manifest math for all depths + 1000 boundary (capPages = ceil(250/pageSize)).
- `readStatePending` never in any cascade; pre-v4 rows fall back to DV06 retention.
- Types (named interfaces, `type` only for unions); no `$effect` introduced.

Advancing to round 2 with the 2 MAJOR + 1 MINOR (computeCachedRanges) + journal fix.

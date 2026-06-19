# RV07 C01 Audit - Round 1

Method: 5 parallel independent full-audit agents (no roles). Change: commit `b947c77`.
Plan: `docs/DV07-Plan.md`. See [[dv04-audit-loop]].

## Verdict

**4/5 UNCONDITIONAL_PASS, 1/5 PASS_WITH_NOTES** → not 5/5. Fix and re-audit.

| Agent | Start file               | Verdict            |
| ----- | ------------------------ | ------------------ |
| 1     | discussions.ts           | UNCONDITIONAL_PASS |
| 2     | sync.ts                  | PASS_WITH_NOTES    |
| 3     | content.ts               | UNCONDITIONAL_PASS |
| 4     | +server.ts               | UNCONDITIONAL_PASS |
| 5     | types/api.ts + migration | UNCONDITIONAL_PASS |

Gates: `bun run check` 0 errors; `bun run lint` exit 0; similarity-ts 0 type-dupes.

## Consensus findings (to fix in round 2)

- **[MAJOR-ish, A2 only] No tiebreaker on metric sorts.** `mostViewed` (`desc(viewCount)`)
  and `mostReplied` (`desc(commentCount)`) in `discussions.ts` and `getCuratedDiscussionIds`
  have no secondary sort. SQLite row order for equal counters is implementation-defined,
  so the curated page-1 ID set can flap between syncs when counters tie at the boundary
  → client reason-set thrash. Fix: add a deterministic `desc(id)` (or `createdAt,id`)
  secondary sort.
- **[MINOR, A1/A2/A4/A5] `partialDiscussionIds` over-broad for `all` depth.**
  `getRepliesForDepth` lists every backfilled discussion as "partial", including
  `all`-depth threads fully cached (≤1000 replies). Benign today (the reader's divider
  is data-driven: `commentCount - cachedCount == 0` → no divider) but the contract is
  muddy and C02 builds on it. Fix: include an id only when the shipped reply set is
  genuinely incomplete vs total (per depth: `first`→total>pageSize; `firstLast`→
  totalPages>2; `all`→over-cap).
- **[MINOR, A1/A2/A4] `void underCapIds;`** dead statement at `sync.ts:512`. Remove.
- **[MINOR, A1/A2/A4] `}` shares a line with a comment** at `sync.ts:336`. Restore
  blank line / prettier-clean.
- **[NOTE, A4] No test pinning the 1000 / 250+250 boundary.** Add a focused test if a
  DAO test harness exists; else record as carry-over.

## Confirmed correct (all 5)

- Behavior preservation: all 4 `getDiscussionsList`/`loadDiscussionsPage` callers omit
  `sort` → default `latest` → online UI byte-identical (empty `categories` param →
  `firstLast` + front/bookmark backfill = DV06 wire shape).
- Decision #3 cap math at the 1000 boundary (`<=` all, `>` first 250 + last 250 via
  per-thread `ROW_NUMBER()` PARTITION).
- Decision #2 ordering (`latest` = `desc(isPinned), desc(lastReplyAt)`; metrics raw
  DESC, no pinned promotion).
- INV-4 (pure reads), INV-7 (categories/depth from query params only), and
  `getReadableCategorySlugs` scoping on every new select (no private-category leak).
- Type rules; sizing (`DISCUSSIONS_LIMIT`=20 curated, `PAGINATION_LIMIT`=50 replies);
  migration `0014` additive index-only.

Advancing to round 2 with the 5 fixes above.

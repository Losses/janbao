# DV07 C01 Journal - Server Curated Pipeline

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: `docs/DV07-Plan.md`.

## Pre-audit dev notes

Built the server-side curated-category pipeline (no client/UI change):

- **DAO multi-sort.** `getDiscussionsList` (`src/lib/server/db/dao/discussions.ts`)
  gains `sort?: 'latest' | 'mostViewed' | 'mostReplied'` (default `latest`).
  `latest` = `desc(isPinned), desc(lastReplyAt), desc(id)` (prior behavior + id
  tiebreaker); `mostViewed` = `desc(viewCount), desc(id)`; `mostReplied` =
  `desc(commentCount), desc(id)` - raw-metric DESC, no pinned promotion. All 4
  existing callers omit `sort` → default `latest` → online UI byte-identical.
- **Curated ID DAO.** `getCuratedDiscussionIds(db, sort, limit, readableSlugs)` in
  `db/dao/sync.ts`; `getFrontPageDiscussionIds` is now a thin `'latest'` delegate
  (DV06 wire shape preserved).
- **Depth-aware reply backfill.** `getRepliesForDepth(db, ids, depth, pageSize,
readableSlugs)` implementing decision #3: `first` → page 1; `firstLast` → page 1
  - last (delegates to existing `getReplyEndpointsFor`); `all` → ≤1000 all rows,
    > 1000 first 250 + last 250 via per-thread `ROW_NUMBER()` PARTITION, middle
    > dropped. `partialDiscussionIds` = genuinely-incomplete-only per depth.
- **Sync endpoint.** `GET /api/sync/content` accepts `?categories=` + `?depth=`
  (INV-7: server stateless, query-params only), returns
  `curatedDiscussionIds: { latest?, mostViewed?, mostReplied? }` + depth backfill
  for the union of curated + front/bookmark ids. Auth-gated, scoped by
  `getReadableCategorySlugs` everywhere (INV-4 pure reads preserved).
- **Migration** `0014_white_storm.sql` - additive indexes on `view_count`,
  `comment_count` (prod D1 manual).
- **Test** `src/lib/server/db/dao/sync.test.ts` (mirrors `fts.test.ts` in-memory
  libsql harness) - pins the 1000 / 250+250 boundary + per-depth partial contract.

## Round 1

- 5 agents. Verdict: **4/5 UNCONDITIONAL_PASS, 1/5 PASS_WITH_NOTES**.
- Findings: (1) metric sorts lacked a deterministic tiebreaker → page-1 ID flap
  on counter ties (stability); (2) `partialDiscussionIds` over-broad for `all`
  depth (contract mud); (3) dead `void underCapIds;`; (4) `}`/comment formatting;
  (5) no boundary test.
- Gate: check 0/0, lint exit 0. See `RV07-C01-Audit-01.md`.

## Round 2

- 5 agents. Verdict: **5/5 UNCONDITIONAL_PASS**.
- All round-1 findings fixed in `4b03112`: `desc(id)` tiebreaker in both DAOs;
  `partialDiscussionIds` narrowed per depth via `getCountsById` + `partialForDepth`;
  cleanup; boundary test added (6/6 pass, 513 assertions).
- Carry-overs logged (CO-C01-1..3): unbounded `endpointIds` union (apply slice if
  limits grow), no tiebreaker-ordering test (add in C02), wasted cap-split work on
  `first` depth.
- Gate: check 0/0, lint exit 0, `bun test sync.test.ts` 6/6. See
  `RV07-C01-Audit-02.md`.

**C01 COMPLETE 5/5.** Advancing to C02 (client sync + reasons + eviction, IDB v4).

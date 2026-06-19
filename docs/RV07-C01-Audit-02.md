# RV07 C01 Audit - Round 2

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff 0a2d9cc..HEAD` (commits `b947c77` + `4b03112`). Round 1 was 4/5; fixes
shipped in `4b03112`. Plan: `docs/DV07-Plan.md`. See [[dv04-audit-loop]].

## Verdict

**5/5 UNCONDITIONAL_PASS** → C01 advances.

| Agent | Start file               | Verdict            |
| ----- | ------------------------ | ------------------ |
| 1     | sync.ts                  | UNCONDITIONAL_PASS |
| 2     | discussions.ts           | UNCONDITIONAL_PASS |
| 3     | content.ts + route       | UNCONDITIONAL_PASS |
| 4     | sync.test.ts (skeptic)   | UNCONDITIONAL_PASS |
| 5     | types/api.ts + migration | UNCONDITIONAL_PASS |

Gates: `bun run check` 0 errors/0 warnings; `bun run lint` exit 0 (0 type-dupes);
`bun test src/lib/server/db/dao/sync.test.ts` 6/6 pass (513 assertions).

## Round-1 fixes confirmed correct (all 5 agents)

- **Tiebreaker:** `desc(id)` appended to all three sorts in BOTH `getDiscussionsList`
  and `getCuratedDiscussionIds`; `latest` otherwise unchanged (callers default to it).
- **`partialDiscussionIds` contract:** now genuinely-incomplete-only per depth
  (`first`→total>pageSize, `firstLast`→totalPages>2, `all`→over-cap>1000) via
  `getCountsById` + `partialForDepth`; return shape + `SyncContentResponse` typing
  unchanged → route/content.ts serialization byte-identical.
- Cleanup: dead `void underCapIds;` removed; `ReplyEndpoints` close brace fixed.
- **Test:** `sync.test.ts` pins ≤1000 (all + not-partial), >1000 (first 250 + last
  250 + verified middle gap + partial), per-depth partial correctness, firstLast
  round-trip parity, and `readableSlugs` leak prevention.

## Carry-overs (informational, non-blocking; log for C02/C06)

- **CO-C01-1** `content.ts` `endpointIds` unions curated (≤60) + front (20) +
  bookmarks with no `.slice(0, MAX_BACKFILL_IDS)` bound. Cannot reach 500 today;
  apply the slice if `DISCUSSIONS_LIMIT` or category count grows.
- **CO-C01-2** No test pins `getCuratedDiscussionIds` ordering / the `desc(id)`
  tiebreaker (asserted by code reading only). Add in **C02**, where curated id
  ordering drives reason-set stability.
- **CO-C01-3** `getRepliesForDepth` computes the cap split even for `depth='first'`
  (wasted filter work, ~20 ids). Lazify inside the `else` block if perf matters.
- Minor: `getCountsById` is called with the full `discussionIds` set (benign —
  absent ids default to 0); delegation test is trivial but the boundary is covered
  elsewhere.

C01 complete. Advancing to C02 (client sync + reasons + eviction, IDB v4).

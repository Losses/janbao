# RV06 · Round 1 Audit - Offline Reading Subsystem (C02)

Scope: full audit of DV06 Cycle 2 - the delta-sync content + read-state endpoints,
server business logic/DAO, IndexedDB offline store + orchestrator + eviction,
client-only `/offline` routes, the discussion-page goto guard, layout sync wiring,
and `offline.reader.*` i18n. Method: 5 parallel independent full-audit agents (no
roles), per [[dv04-audit-loop]]. Plan: DV06-Plan.md.

## Round 1 verdicts (5 independent full-audit agents)

- Agent A: PASS_WITH_NOTES
- Agent B: PASS_WITH_NOTES
- Agent C: CONDITIONAL_FAIL (2 CRITICAL)
- Agent D: PASS_WITH_NOTES
- Agent E: PASS_WITH_NOTES

0/5 unconditional - not advancing. Strong consensus on the tombstone-cursor bug;
Agent C surfaced two additional scope/ordering MAJORs that were real.

## MAJOR - fixed this round

- **Shared tombstone cursor dropped tombstones** (`src/lib/server/sync/content.ts`).
  Both tombstone streams advanced a single `tombstoneAfter = max(lastD, lastR)`;
  when one stream filled the page faster it advanced the watermark past tombstones
  the slower stream hadn't shipped, permanently skipping them. Fixed: split into
  per-stream cursors (`discussionTombstoneAfter`, `replyTombstoneAfter`), each
  advanced only by its own stream's last row. (All 5 agents.)
- **Front-page / bookmark id sets were not scoped by readable categories**
  (`src/lib/server/db/dao/sync.ts`). `getFrontPageDiscussionIds` and
  `getBookmarkedDiscussionIds` joined only on `disabledAt IS NULL`, leaking the
  existence + deletion timing of discussions in private categories the user can't
  read, and corrupting eviction correctness (a private thread could displace a
  visible one in the protected top-N). Fixed: both now take `readableSlugs` and
  filter `inArray(categorySlug, readableSlugs)`. (Agents B, C.) The tombstone
  queries were scoped the same way for the same reason.
- **Front-page ordering diverged from the live home page** (`getFrontPageDiscussionIds`).
  Used `coalesce(lastReplyAt, createdAt)` while the live home page orders by bare
  `desc(isPinned), desc(lastReplyAt)` (verified in `db/dao/discussions.ts`). A
  no-reply thread could rank "on the front page" for eviction while not being
  visible. Fixed: orderBy now matches the live query exactly. (Agent C.)
- **Read-state LWW ignored clock skew** (`src/lib/offline/read-state.ts`). The
  client stamped `lastReadAt` from its own clock; a drifted client would always
  lose last-write-wins. Fixed: `recordOfflineRead` adds the persisted
  `serverTimeSkew` so the stamp is in approximate server time. (Agent C.)

## MINOR - fixed this round

- Outbox flush drained only the dedupe winner, leaving older sibling reads to be
  re-sent next flush. Fixed: per-discussion compound-range delete
  `[discussionId, 0]..[discussionId, sent]` clears the winner + older siblings
  while preserving any newer read recorded mid-flush. (Agents A, D, E.)
- Conflict reconciliation wrote `lastReadPage: 0` (invalid page). Now `1`, and
  runs before the outbox clear so a failure doesn't lose unacked rows. (Agent C.)
- `getBookmarkedDiscussionIds` now filters soft-deleted discussions. (Several.)
- `/offline` list sort aligned to live (bare `lastReplyAt`, NULL last). (Agent C.)
- `recordOfflineRead` gated on `!navigator.onLine` (the online path marks read
  server-side). (Agent B.)

## Carry-overs (accepted with rationale - not re-fixed)

- `applyReadStateDeltas` issues N sequential SELECT + UPSERT per call (up to
  `MAX_DELTAS=200`); a batched CTE upsert would reduce latency. Performance, not
  correctness; the pre-check is also belt-and-suspenders with the `ON CONFLICT …
  WHERE` clause. (Several agents.)
- Offline reader is single-page (`lastReadPage=1`, renders all cached replies) -
  acceptable for an offline reader; the online route paginates. (Several.)
- `applied` counter may over-count on a no-op upsert (concurrent read won between
  SELECT and UPSERT). Telemetry only. (Agent E.)
- `INITIAL_LOOKBACK_DAYS=30` bounds the first sync (deltas AND tombstones default
  to the lookback, not 0). (Verified - not a defect.)

## Gate (end of round 1, after fixes)

- `bun run check`: exit 0 (svelte-check 1231 files 0/0 + `tsc -p tsconfig.sw.json`).
- `bun run lint`: exit 0 (15 similar-type pairs, all informational, no duplicates).
- `bun run build`: exit 0.

## Next

Round 2: re-audit with the carry-over list; target 5/5 UNCONDITIONAL_PASS. The
tombstone-cursor and scope fixes are the highest-risk changes to re-verify.

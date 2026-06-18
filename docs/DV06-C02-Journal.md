# DV06 C02 Journal - Offline Reading Subsystem Audit Loop

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: DV06-Plan.md.

## Pre-audit dev notes

Built the offline reading subsystem:

- `GET /api/sync/content` - pure-read delta sync (discussions + replies by
  `(updatedAt,id)` cursor, per-stream tombstone cursors, front-page + bookmark id
  sets), all scoped to the caller's readable categories.
- `PUT /api/sync/read-state` - last-write-wins upsert into `discussion_reads`
  (strict `>` skip + `ON CONFLICT … WHERE`), never flips `notifications.is_read`.
- `src/lib/server/sync/{content,read-state}.ts` + `db/dao/sync.ts`;
  `getOfflineRetentionDays`; `OFFLINE_RETENTION_DAYS` in PlatformEnv.
- `src/lib/offline/*` (dexie IDB with 5 stores, paged sync orchestrator with a
  singleton lock + MAX_PAGES cap, read-state outbox, front-page + bookmark-exempt
  TTL eviction); client-only `/offline` list + `/offline/[id]` reader (`ssr=false`,
  no `+page.server.ts` - structural INV-4); online-route `goto` guard; layout
  reconnect triggers `runSync` + banner "Read offline" link.
- Migration `0012_clammy_rage.sql` adds `(updated_at,id)` + `deleted_at` indexes on
  discussions and replies.

## Round 1

- 5 agents. Verdict: 0/5 unconditional (A/B/D/E PASS_WITH_NOTES, C CONDITIONAL_FAIL).
- MAJOR consensus (all 5): a single shared tombstone cursor dropped tombstones when
  the two streams filled the page at different rates. Fixed: split into per-stream
  `discussionTombstoneAfter` / `replyTombstoneAfter`.
- MAJOR (C, B): front-page + bookmark id sets (and tombstones) were not scoped by
  readable categories - leaking private-category ids and corrupting eviction. Fixed:
  all four queries now take `readableSlugs` and filter `inArray(categorySlug, …)`.
- MAJOR (C): front-page ordering used `coalesce(lastReplyAt, createdAt)` while the
  live home page orders by bare `desc(isPinned), desc(lastReplyAt)` (verified). Fixed
  to match exactly.
- MAJOR (C): read-state LWW ignored clock skew. Fixed: `recordOfflineRead` stamps
  `lastReadAt` in approximate server time (client now + persisted `serverTimeSkew`).
- MINOR (A/D/E + C): outbox flush drained only the dedupe winner; now a per-
  discussion compound-range delete clears the winner + older siblings while
  preserving newer reads; conflict reconciliation moved before the clear and uses
  `lastReadPage: 1`; bookmark ids filter soft-deleted; `/offline` list sort aligned
  to live; `recordOfflineRead` gated on offline.
- Carry-overs: `applyReadStateDeltas` N sequential queries (perf); offline reader is
  single-page; `applied` counter may over-count on no-op upsert (telemetry).
- User decision mid-cycle: **the offline-aware disable sweep (grey-out bookmark /
  editors / settings / admin / messages; form-disable on forced URL; empty-state for
  offline lists) is a separate new cycle (C03)**, not C02. Bookmark stays a server
  write, unavailable offline in C02. See Plan scope (five cycles).
- Gate: check 0/0 (incl. SW gate), lint exit 0, build exit 0. See RV06-C02-Audit-01.md.
- Advancing to round 2 targeting 5/5 UNCONDITIONAL_PASS.

## Round 2

- 5 agents. Verdict: 3/5 UNCONDITIONAL_PASS (A, B, C), 2/5 CONDITIONAL (D, E).
- MAJOR (E): tombstones lacked the `id` tiebreaker the delta streams had - a
  same-second `deletedAt` tie at a page boundary could drop rows. Fixed: tombstone
  streams now use the compound `(deletedAt, id)` cursor like the deltas.
- MAJOR (D): first sync seeded tombstone cursors to `0` and always sent them, so the
  server lookback never applied on a fresh install. Fixed: tombstone cursors are sent
  only when stored, letting the server apply the 30-day lookback.
- MAJOR (E): read-state conflict reconciliation unconditionally clobbered the merged
  row, regressing a read recorded mid-flush. Fixed: last-write-wins guard.
- Investigated, not a defect: Agent D's offline-list NULL-ordering claim - SQLite DESC
  puts NULLs last, matching `?? 0`. Consistent.
- Carry-overs: online read path can clobber an unflushed offline read (narrow, online
  route out of C02 scope per INV-4); `lastReadPage: 1` in conflict reconciliation
  (DTO has no server page); perf/telemetry items; disable sweep = C03.
- Gate: check 0/0, lint exit 0, build exit 0. See RV06-C02-Audit-02.md.
- Advancing to round 3 targeting 5/5 UNCONDITIONAL_PASS.

## Round 3

- 5 agents with the expanded carry-over list. Verdict: **5/5 UNCONDITIONAL_PASS**.
- All round-2 fixes verified (tombstone `(deletedAt,id)` compound cursor; first-sync
  lookback; conflict-merge LWW guard). No new findings, no regressions.
- (One agent missed the discussion-page `goto` guard on grep; confirmed present at
  `+page.svelte:37-50`.)
- Informational: tombstone indexes are single-column `(deleted_at)` while queries sort
  by `(deleted_at, id)` - the `id` tiebreak is an in-page sort; a compound index would
  close the perf asymmetry (deferred).
- Gate: check 0/0, lint exit 0, build exit 0. See RV06-C02-Audit-03.md.
- **DV06 C02 COMPLETE 2026-06-17** - closed in 3 rounds (~15 sub-agent audits).
  Advances to C03 (offline-aware UX disable sweep).

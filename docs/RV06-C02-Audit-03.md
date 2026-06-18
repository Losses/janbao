# RV06 · Round 3 Audit - Offline Reading Subsystem (C02)

Re-audit of DV06 Cycle 2 after the Round 2 fixes, with the expanded carry-over list.
Method: 5 parallel independent full-audit agents (no roles), per [[dv04-audit-loop]].

## Round 3 verdicts (5 independent full-audit agents)

- Agent A: UNCONDITIONAL_PASS
- Agent B: UNCONDITIONAL_PASS
- Agent C: UNCONDITIONAL_PASS
- Agent D: UNCONDITIONAL_PASS
- Agent E: UNCONDITIONAL_PASS

**5/5 UNCONDITIONAL_PASS.**

## Round 2 fixes - verified by all agents

- **Tombstone `(deletedAt, id)` compound cursor** - both tombstone DAOs now use
  `or(gt(deletedAt, since), and(eq(deletedAt, since), gt(id, sinceId)))` ordered by
  `(deletedAt, id)`, mirroring the delta streams. Same-second delete tie groups can no
  longer be dropped at a page boundary. All four streams share the identical
  `"<seconds>:<id>"` cursor pattern.
- **First-sync lookback** - the orchestrator sends each cursor param only when a stored
  value exists, so the first sync lets the server apply the 30-day `INITIAL_LOOKBACK`
  uniformly (no epoch-0 tombstone fetch on a fresh install).
- **Read-state conflict-merge LWW guard** - the client now only overwrites the merged
  row when `existing.lastReadAt <= c.serverLastReadAt`, preserving a newer local read
  recorded mid-flush. Server-side LWW is enforced at two layers (pre-check +
  `ON CONFLICT … WHERE`).

## New findings

None at CRITICAL/MAJOR/MINOR. No regressions.

## Informational (not blocking)

- The tombstone indexes are single-column `(deleted_at)` while the queries order by
  `(deleted_at, id)`; the `id` tiebreaker is resolved as an in-page sort. A compound
  `(deleted_at, id)` index (mirroring the delta `(updated_at, id)` indexes) would close
  the perf asymmetry. Purely informational.
- A dev IDB that ran the round-1 build may have a stored `0:0`-style tombstone cursor;
  production (never deployed) is unaffected and round-2 prevents new clients from ever
  storing it.

## Carry-overs - unchanged from Round 2

Online read-path no-WHERE-guard clobber (online route out of C02 scope per INV-4);
`lastReadPage: 1` in conflict reconciliation (DTO has no server page);
`applyReadStateDeltas` N sequential queries (perf); single-page offline reader;
`applied` counter over-count (telemetry); offline disable sweep + bookmark-unavailable-
offline = separate cycle C03.

## Gate (end of round 3)

- `bun run check`: exit 0 (1231 files 0/0 + SW gate).
- `bun run lint`: exit 0.
- `bun run build`: exit 0.

## Outcome

**DV06 C02 COMPLETE 2026-06-17** - closed in 3 rounds (~15 sub-agent audits). The
offline reading subsystem is release-ready: delta sync (pure-read, category-scoped,
compound cursors), read-state sync-back (last-write-wins, server-time-stamped,
no false-read), per-entity IndexedDB store, front-page + bookmark-exempt TTL eviction,
client-only `/offline` reader. Advances to C03 (offline-aware UX disable sweep).

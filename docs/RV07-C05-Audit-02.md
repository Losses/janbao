# RV07 C05 Audit - Round 2

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff a7df7e1..HEAD` (commits 3ad732d + 663127d). Round 1 was 4/5 + 1 FAIL;
fix shipped in `663127d`. Plan: `docs/DV07-Plan.md`. See [[dv04-audit-loop]].

## Verdict

**5/5 UNCONDITIONAL_PASS** → C05 advances.

| Agent | Start file                       | Verdict            |
| ----- | -------------------------------- | ------------------ |
| 1     | passthrough.ts                   | UNCONDITIONAL_PASS |
| 2     | refresh-policy + evict (skeptic) | UNCONDITIONAL_PASS |
| 3     | types.ts + orchestrator          | UNCONDITIONAL_PASS |
| 4     | integration skeptic              | UNCONDITIONAL_PASS |
| 5     | refresh-policy + types           | UNCONDITIONAL_PASS |

Gates: `bun run check` 0 errors/0 warnings; `bun run lint` exit 0 (0 type-dupes);
`bun test` 82/82.

## Round-1 fixes confirmed correct (all 5 agents)

- **[CRITICAL A4 → fixed] `readUpdatedAt` now SECONDS.** Both passthrough write
  sites use `Math.floor(Date.now()/1000)` (matches the `toEpochSeconds` convention
  for every other cached timestamp; `readUpdatedAt` was the outlier in raw ms).
  Traced end-to-end: a 31-day-stale read → `isReadStale` true → `'read'` dropped
  (cascade-evict if read-only, trimmed if it has other reasons); re-entering online
  refreshes `readUpdatedAt` → not stale. The 30-day TTL now actually fires.
  `cachedAt`/`fetchedAt`/`lastSyncAt` stay ms but are bookkeeping-only (never fed
  to TTL math) - no latent dead-check.
- **[regression test]** realistic-magnitude cases (`NOW_SEC_REALISTIC ≈ 1.8e9`;
  fresh/29d not stale; 30d boundary stale; 31d stale) + an epoch-ms sentinel
  (`1.78e12` must NOT parse as seconds). Would have failed on the pre-fix code.
- **[A5 → fixed] `REASON_ORDER` hoisted** to one shared `readonly Reason[]` in
  `types.ts`; imported (not re-declared) by evict/orchestrator/passthrough; byte-
  identical 6-entry ordering → `withReadReason`/`recomputeReasons`/`withoutRead`
  array identity stable.

## Carry-overs (informational, non-blocking)

- **CO-C05-1** perf: `decideRefreshCurated` does 2 `syncMeta.get` (could `bulkGet`);
  `expireReadReasons` + `applyEviction` each `db.discussions.toArray()`;
  `backfillMissingUsers` full-scans discussions+replies every sync (pre-existing
  DV06). Non-blocking.

## Confirmed correct (all 5)

- **Trigger lines distinct:** delta sync UNTHROTTLED every reconnect/mount (DV06);
  curated refresh THROTTLED (signature-force on pref change, interval gate,
  first-run force); when skipped sends `categories=` + `depth=firstLast` (DV06 wire)
  and bypasses curated branches. Passthrough separate (C04).
- **DV06 preservation:** `!enabled` byte-identical (no curated reasons ever set).
- **`readStatePending` never deleted** (absent from both `applyEviction` +
  `expireReadReasons` txn store lists; every written store listed - no rollback).
- **`read` reason:** orchestrator never adds/removes; `expireReadReasons` sole
  remover; `readUpdatedAt` read-only in evict.
- INV-4 (no server writes); no `$effect` loops; types (named interfaces).

C05 complete. Advancing to C06 (full-system integration audit).

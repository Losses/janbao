# RV07 C05 Audit - Round 1

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff a7df7e1..HEAD` (commit 3ad732d). Plan: `docs/DV07-Plan.md`.
See [[dv04-audit-loop]].

## Verdict

**4/5 UNCONDITIONAL_PASS, 1/5 FAIL** → fix and re-audit.

| Agent | Start file               | Verdict            |
| ----- | ------------------------ | ------------------ |
| 1     | refresh-policy.ts (pure) | UNCONDITIONAL_PASS |
| 2     | sync-orchestrator.ts     | UNCONDITIONAL_PASS |
| 3     | evict.ts (read-TTL)      | UNCONDITIONAL_PASS |
| 4     | integration skeptic      | FAIL               |
| 5     | types + regression       | UNCONDITIONAL_PASS |

Gates: `bun run check` 0/0; `bun run lint` exit 0 (0 type-dupes); `bun test` 77/77.

## CRITICAL finding (must fix)

- **[CRITICAL, A4] `readUpdatedAt` unit mismatch → 30-day TTL is dead code.**
  `passthrough.ts` writes `readUpdatedAt = Date.now()` (epoch **milliseconds**,
  ~1.78e12) at the two write sites, but `isReadStale`/`expireReadReasons` treat it
  as epoch **seconds** (~1.78e9). `nowSec - readUpdatedAtMs` is always hugely
  negative → `isReadStale` returns false unconditionally → the `'read'` reason
  never expires → read-cached threads leak indefinitely (the "30-day auto-clean"
  requirement silently never fires). The pure TTL tests masked this (used a
  seconds-scale `NOW` fixture). **Fix:** write `Math.floor(Date.now()/1000)` in
  passthrough (seconds - consistent with every other cached timestamp, which the
  C04 `toEpochSeconds` normalization already produces for createdAt/updatedAt/
  lastReplyAt; readUpdatedAt was the outlier). Add a regression test using
  realistic-magnitude (seconds) timestamps so the unit contract is pinned.

## MINOR findings (fix alongside)

- **[A5] `REASON_ORDER` duplicated** as literals in `evict.ts` + `sync-orchestrator.ts`
  (the same 6-entry ordering). Hoist to one shared constant in `types.ts` (or a
  shared module) - same class as CO-C02-2 (REPLY_CAP dedup).
- **[A2, informational]** `decideRefreshCurated` does 2 `syncMeta.get` (could
  `bulkGet`); `expireReadReasons` + `applyEviction` each `db.discussions.toArray()`;
  `backfillMissingUsers` full-scans discussions+replies every sync (pre-existing
  DV06). Non-blocking perf notes - log as **CO-C05-1**.

## Confirmed correct (all 5)

- **Trigger lines distinct:** delta sync (cursors, front/bookmark reasons+manifest,
  `applyEviction`, `flushPendingReadState`, `backfillMissingUsers`) runs
  UNTHROTTLED every reconnect/mount (DV06); curated refresh (`?categories=&depth=`,
  curated reason-set diff, curated manifest merge, `persistCuratedMeta`) is
  THROTTLED; when skipped sends `categories=` + `depth=firstLast` (DV06 wire) and
  bypasses curated branches (curated reasons untouched). Passthrough separate (C04).
- **Throttle + signature-force:** `shouldRefreshCurated` - `!enabled`/no-categories
  → never; signature mismatch → force; first-run → force; else `now-last >=
interval*86400` (boundary-inclusive). Signature = enabled+3 categories+depth
  (excludes interval/passthrough). Watermark + signature persisted only on a
  successful curated refresh.
- **DV06 preservation:** `!enabled` byte-identical (no curated reasons ever set).
- **`readStatePending` never deleted** (absent from both `applyEviction` +
  `expireReadReasons` txn store lists; every store written inside is listed - no
  C02-style rollback). Reason-set eviction intact (`withoutRead`; cascade only on
  empty).
- **`read` reason:** orchestrator never adds/removes it; `expireReadReasons` is the
  sole remover; `readUpdatedAt` read-only in evict.
- INV-4 (no server writes); no `$effect` loops; types (named interfaces).

Advancing to round 2 with the CRITICAL unit fix + test + REASON_ORDER dedup.

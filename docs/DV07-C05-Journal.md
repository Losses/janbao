# DV07 C05 Journal - Scheduled Curated Refresh + Read-Reason 30-Day TTL + Trigger-Line Split

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: `docs/DV07-Plan.md`. Built
on C04 (`docs/DV07-C04-Journal.md`, read passthrough + derived manifest +
multi-range gap rendering COMPLETE 5/5). **C05 base commit:
`a7df7e1838f166594d92acf366bb494976df3175`.**

## Pre-audit dev notes

### Trigger-line split (Plan invariant)

`runSync` → `doSync` now has THREE distinct decision paths that must not
collapse:

1. **Delta sync** (cursors + front/bookmark sets + read-state outbox flush +
   `applyEviction` + `backfillMissingUsers`): runs UNTHROTTLED on every
   reconnect/mount. DV06 behavior preserved verbatim. The page loop ALWAYS
   runs and ALWAYS advances the four cursors.
2. **Curated refresh** (the `categories=<...>&depth=<...>` request body +
   the curated reason-set add/remove against `curated:<cat>` syncMeta +
   the depth-policy manifest merge for curated ids + the
   `curated:<cat>` mirror write): runs ONLY when `decideRefreshCurated`
   returns true. When skipped, the page loop sends `categories=` empty +
   `depth=firstLast` (DV06 wire shape) and the orchestrator's curated
   branch in `applyReasonSets` + `mergeDepthRangesIntoManifests` is
   bypassed entirely — curated reasons from the last refresh persist
   untouched this run.
3. **Read passthrough** (C04): untouched. Owned by the route-layer writers,
   fires on every browse regardless of the throttle decision.

The split lives in the existing single fetch loop (the server already
interleaves delta + curated in one response), but the **reason-set +
manifest application** is partitioned by `refreshNow` so the curated
half cannot run on a throttled-out pass. `applyReasonSets` takes a new
`curatedRefresh: boolean` arg: when false it skips the curated category
loop AND skips the `persistCuratedMeta` write. `mergeDepthRangesIntoManifests`
is fed `{}` for the curated map when not refreshing so no curated id
enters the manifest step.

### Throttle + signature force (deliverable 2)

Pure helpers extracted into `src/lib/offline/refresh-policy.ts`:

- `READ_RETENTION_DAYS = 30` — client-side TTL for the `'read'` reason
  (distinct from the server `OFFLINE_RETENTION_DAYS = 14` legacy fallback
  in `evict.ts`, which still applies to pre-v4 rows lacking a reasons
  array).
- `prefsSignatureOf(prefs)` — normalized string form of the prefs fields
  that govern cached content: `enabled + categories.{latest,mostViewed,
mostReplied} + depth`. `refreshIntervalDays` and `passthrough` are
  intentionally NOT part of the signature (they affect cadence / read
  path, not the cached content set).
- `shouldRefreshCurated({nowSec, lastCuratedRefreshAtSec, intervalDays,
prefsSignature, storedSignature, enabled, hasAnyCategory})`:
  - `!enabled || !hasAnyCategory` → NEVER (DV06 path; curated reasons
    never set, never touched).
  - signature mismatch → FORCE (covers C03's "sync after pref change"
    nicety + any category toggle, without an explicit signal from the
    settings UI).
  - first run (`lastCuratedRefreshAtSec === undefined`) → FORCE.
  - else throttle: `nowSec - last >= intervalDays * 86400` (>=, not >).
- `isReadStale(readUpdatedAtSec, nowSec, retentionDays)`: pure decision
  for the read-TTL step. Exactly N days elapsed → stale (>=). Undefined
  readUpdatedAt → not stale (leave to `applyEviction`'s legacy fallback).

`doSync` reads `syncMeta.lastCuratedRefreshAt` + `lastCuratedPrefsSignature`
once at start via `decideRefreshCurated`, decides `refreshNow`, then
persists both keys ONLY when `refreshNow` is true (so the throttle
comparison remains monotone against the last actual refresh).

### Category cleanup diff (deliverable 3)

Confirmed: the existing C02 reason-set diff logic (per-category
`curated:<cat>` mirror → add new entrants, remove lapsed members) runs
ONLY on the curated-refresh path. When `curatedRefresh` is false the
entire `for (const b of CATEGORY_BINDINGS)` block is skipped AND
`persistCuratedMeta` is not called — so a throttled-out pass cannot
shed curated reasons against an empty `curated` set. Edits/deletes
still flow through the delta cursors on every pass (unchanged).

### Read-reason 30-day TTL (deliverable 4)

New `expireReadReasons()` in `src/lib/offline/evict.ts`. Runs on every
sync, BEFORE `applyEviction`. For each cached discussion:

1. Has `'read'` reason AND `isReadStale(readUpdatedAt, now, 30)` →
   flagged stale.
2. `withoutRead(reasons)` (pure, exported, unit-tested) drops `'read'`
   and re-orders the survivors canonically.
3. If the trimmed array is non-empty → `bulkPut` the row with the
   trimmed reasons (other reasons own the row's lifecycle).
4. If the trimmed array is empty → cascade-delete via the same store
   list as `applyEviction` (discussions + replies + readStateMerged +
   replyCacheManifest). `readStatePending` is deliberately NOT in the
   store list — the outbox must survive even when its discussion
   scrolls out of cache.

`readUpdatedAt` is read-only here; passthrough (C04) is the sole writer.
Re-entering the thread online refreshes `readUpdatedAt` so active reads
never expire.

## Invariants preserved

- **INV-4 (no false read)**: C05 adds ZERO server writes. The sync
  endpoint stays pure-read. `expireReadReasons` is a client IDB
  mutation only.
- **DV06 byte-identical when `!enabled`**: `decideRefreshCurated`
  returns false → request sends `categories= + depth=firstLast` →
  server response is byte-identical to DV06. The orchestrator's curated
  reason/manifest branches are bypassed (so curated reasons are NEVER
  touched on this path — they were never set). Delta + front/bookmark
  - eviction + outbox flush run exactly as DV06.
- **No `$effect` loops** ([[svelte-effect-fetch-loop]]): C05 touches
  only `.ts` files; the orchestrator is still invoked from existing
  `onMount` / `online` event hooks. No new reactive surface.
- **Reason-set eviction**: intact. `expireReadReasons` uses the same
  cascade store list as `applyEviction`; `readStatePending` never in
  either. The two steps run sequentially (expire → evict) so they
  cannot fight over the same row.
- **Trigger lines distinct**: delta sync (unthrottled) vs curated
  refresh (throttled) vs read passthrough (per-browse) are now three
  separate decision points in code, not one collapsed path.

## Type rules (zero tolerance)

- All new types are named interfaces (`ShouldRefreshCuratedInput`,
  `PrefsSignatureInput`) or named function signatures.
- `interface` over `type` for object shapes; `PrefsSignature` is a
  type alias for `string` (a branded-ish alias, not an object shape).
- No inline typing: the `withoutRead` predicate uses a type guard
  `r is Exclude<Reason, 'read'>` rather than an inline object literal.
- `READ_RETENTION_DAYS` is a `const`, not a magic number.

## Tests added

- `src/lib/offline/refresh-policy.test.ts` (14 cases): throttle boundary
  (just-under → skip, at/over → refresh), signature-mismatch forces,
  `!enabled`/no-categories → never, first-run force, read-TTL at
  exactly 30d, undefined readUpdatedAt, far-future, prefs signature
  stability across `refreshIntervalDays` / `passthrough` changes,
  deterministic shape.
- `src/lib/offline/evict.test.ts` (6 cases): `withoutRead` pure
  decision — read-only → empty, read + others → others kept canonically,
  all-curated + read, no read present, empty, defensive dedupe.

Pure-logic only (no Dexie harness in the repo); the IDB-touching half
of `expireReadReasons` + the orchestrator's curated-throttle wiring are
exercised via the integration audit (RV07-C05-\*).

## Gates

- `bun run check`: 0 errors / 0 warnings / 1277 files.
- `bun run lint`: exit 0 (prettier clean, eslint clean, similarity-ts
  type-dupes 0 — 27 informational pairs, all pre-existing).
- `bun test`: 77/77 pass (refresh-policy 14 + evict 6 + carry-over 57).

## Carry-overs

- **CO-C05-1** `lastCuratedRefreshAt` is client-clock epoch seconds.
  Clock skew across reconnects could in principle cause a double-
  refresh within a second; harmless (idempotent). The server-time-skew
  correction stored in `serverTimeSkew` syncMeta is intentionally NOT
  applied to this comparison — the refresh cadence is a client policy,
  not a server-coherency check.
- **CO-C05-2** A prefs signature mismatch forces refresh even when the
  throttle window has barely elapsed. This is by design (decision #2's
  "force on pref change"), but means a user rapidly toggling a category
  on/off across two syncs will trigger two refreshes back-to-back. The
  second refresh sees an empty curated set for that category and sheds
  its reason — correct behavior, no throttling needed.

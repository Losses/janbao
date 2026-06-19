# DV07 C02 Journal - Client Sync + Reasons + Eviction (IDB v4)

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: `docs/DV07-Plan.md`. Built on
C01 (`docs/DV07-C01-Journal.md`, server curated pipeline COMPLETE 5/5).

## Pre-audit dev notes

- **Prefs storage layer** `src/lib/offline/prefs.ts` (non-reactive; C03 builds
  the store). Named `OfflinePrefs` (enabled / category toggles / depth / refresh
  interval / passthrough), `DEFAULT_OFFLINE_PREFS` = off/DV06-default, SSR-safe
  `readOfflinePrefs` / `writeOfflinePrefs` over localStorage key
  `janbao:offline-prefs:v1`. Shape-validated coercion: any invalid field falls
  back to default, a fully corrupted entry yields the whole default.
- **IDB v3→v4** in `src/lib/offline/idb.ts`. Adds `replyCacheManifest` store
  (keyPath `discussionId`); `CachedDiscussion` gains optional `reasons: Reason[]`
  and `readUpdatedAt?: number` (optional so v3 rows upgrade in place; the next
  sync backfills). The pre-existing `versionchange` / `blocked` handlers cover
  the upgrade.
- **Reason model** in `src/lib/offline/types.ts`: `Reason` union of
  `latest` / `mostViewed` / `mostReplied` / `read` / `front` / `bookmark`,
  plus `CachedRange` / `ReplyCacheManifestRow` / `CuratedSyncMetaRecord` /
  `CuratedSyncMetaMap` (syncMeta now accepts the curated-mirror records).
- **Manifest helpers** `src/lib/offline/manifest.ts`: pure functions
  `computeCachedRanges(depth, totalPages, pageSize)`, `isComplete(ranges,
totalPages)`, `computeReplyGaps(manifest, commentCount)` implementing
  decision #3 (first / firstLast / all under-cap / all over-cap = first 250 +
  last 250 = 5 pages each side at pageSize 50). Cap is on rows; uses
  `totalPages * pageSize` as the over-estimate so the cap never silently misses
  at the boundary.
- **Sync orchestrator** `src/lib/offline/sync-orchestrator.ts`:
  - Reads prefs. `!enabled` OR no categories ⇒ `categories=` + `depth=firstLast`
    (DV06 wire shape, byte-identical).
  - Otherwise sends `categories=<enabled>` + `depth=<prefs.depth>`.
  - **Reason tagging** after the page loop: for each curated category, union the
    reason onto every id in the freshly-fetched set, remove from ids no longer
    in it (diff vs prior `curated:<cat>` syncMeta row). `front` +
    `bookmark` mirror in the same pass, unifying DV06's exemption into the
    reason set. `read` is NEVER touched here (passthrough / C04 owns it). The
    curated snapshot is mirrored into `syncMeta` keys `curated:latest` /
    `curated:mostViewed` / `curated:mostReplied` as `{ ids, fetchedAt }` for
    C05 diffing.
  - **Manifest population** for the union of curated + front + bookmark ids:
    one row per discussion, derived from `depth + commentCount + pageSize`.
    Overwritten on every sync.
  - Content upsert carries forward the row's existing `reasons` /
    `readUpdatedAt` (the reason recompute after the loop is authoritative for
    category/front/bookmark; readUpdatedAt is passthrough-owned).
- **Eviction** `src/lib/offline/evict.ts`: reason-set-driven. A row with ≥1
  reason is exempt regardless of age. Pre-v4 rows (no `reasons`) fall back to
  the DV06 rule (off front/bookmark AND older than `retentionDays`). `readStatePending`
  (outbox) is never touched; replies + `readStateMerged` + dangling manifest
  rows cascade. `OFFLINE_RETENTION_DAYS = 14` is exported (C05 reuses it for
  the `read` TTL).
- **Gap computation** in `src/routes/offline/[discussionId]/+page.ts`: the
  existing single-divider `partialGap` is kept (renderer unchanged); the
  generalized `replyGaps` (from `computeReplyGaps`) is added alongside so C04
  can switch the renderer to the multi-gap view without touching load logic.
- **Tests** `src/lib/offline/manifest.test.ts` (11 cases, pure functions, no
  Dexie harness needed) pins `computeCachedRanges` / `isComplete` /
  `computeReplyGaps` boundaries (1000-cap, 250/50 split, gap scan, stale-
  totalPages clamp). Reason-set update is IDB-driven and is exercised via the
  integration audit (no fake-indexeddb harness in the repo).

## Invariants preserved

- **INV-4** (no false read): the orchestrator issues only the existing pure-read
  `GET /api/sync/content` (+ the read-state outbox flush on reconnect). No new
  server write paths.
- **DV06 behavior gate**: the `!enabled` path sends `categories=` +
  `depth=firstLast`, so the server request and response are byte-identical to
  DV06 (no curated sets returned; front/bookmark union backfilled with
  firstLast depth). The client DOES still make additive IDB writes on this
  path: it persists the echoed front/bookmark snapshots to syncMeta, mirrors
  `curated:*` records, and applies `front`/`bookmark` reasons to the affected
  rows. These writes are additive and observable only via the new
  `replyGaps`/reason-set paths (which fall back to empty/DV06 behavior), so
  they do not alter observable DV06 read behavior.
- **No `$effect` loops** ([[svelte-effect-fetch-loop]]): C02 touches only
  `.ts` files; the orchestrator is invoked from existing client hooks (no new
  reactive surface).
- **Reason-set eviction**: front/bookmark discussions carry those reasons now,
  so they remain exempt — same observable behavior as DV06's hard-coded
  exemption.

## Round 1

Pending. Will run 5 parallel full-audit agents against this commit; loop to
5/5 UNCONDITIONAL_PASS before advancing to C03.

## Carry-overs

(to be filled post-audit)

# DV07 Plan - User-Controllable Offline Cache (Curated Categories + Read Passthrough)

Builds on DV06 (PWA + passive offline reading, all 5 cycles COMPLETE). DV06 caches
the front page + bookmarks with first/last-page replies - a **passive snapshot**.
DV07 makes caching **user-controllable**: pick which category lists to cache, how
deep each thread's replies go, auto-cache what you browse, tag every cached row with
a reason, and refresh/evict on a schedule.

See `docs/DV06-Plan.md` for the DV06 invariants this extends.

## Goal

Turn offline reading from "whatever the front page happened to be" into a
**user-curated, self-maintaining** offline library:

- A new **Offline Reading** settings section. Default **off**; auto-on
  only when the site is running as an **installed PWA**.
- Cache **one list page** of each enabled category: **latest** /
  **most-viewed** / **most-replied**.
- Per-thread **reply depth** policy: first page / first+last page / all (capped).
- **Read passthrough** (default on): data already downloaded while browsing is
  written to the offline store; re-entering a thread online refreshes its cache.
- Every cached discussion is **tagged with its cache reason**; eviction is
  reason-set-driven.
- **Scheduled refresh** (1/2/3/5/7 days) keeps curated categories current;
  **read-cached** rows auto-clean after **30 days** untouched.

## Locked decisions (from user)

1. **Preferences are local** (client `localStorage`), not server-side. Offline
   cache is inherently per-device; prefs match. No DB columns, no API writes for
   prefs. Guests cannot enter the settings UI and cannot enable caching.
2. **"最新" (latest) = `lastReplyAt`** ordering (matches the live homepage:
   `isPinned DESC, lastReplyAt DESC`). Not `createdAt`.
3. **Reply cap = 1000.** Depth `all`: if a thread has ≤ 1000 replies, cache every
   page; if > 1000, cache **first 250 + last 250** replies (= pages 1–5 and the
   last 5 pages at `PAGINATION_LIMIT=50`), middle rendered as a gap. Depth
   `firstLast` always = page 1 + last page. Depth `first` = page 1 only.
4. **Reason model:** `reasons: Reason[]` + `readUpdatedAt?: number` **on the
   discussion record** (display + eviction source of truth). Curated category ID
   sets **mirrored in `syncMeta`** for refresh diffing. A row is deleted only when
   its reason set becomes empty.
5. **Auth-only.** `/profile/offlineReading` requires login (redirect like other
   `/profile/*` routes). Sync API already auth-gated. Read passthrough gated on
   authed + pref on. Guests get no cache.

### Reason enum

`'latest' | 'mostViewed' | 'mostReplied' | 'read' | 'front' | 'bookmark'`.
`front`/`bookmark` preserve DV06 semantics (front-page snapshot / bookmark exempt).
A discussion may hold several reasons simultaneously.

## Invariants (carry over + new)

- **INV-4 (no false read):** preserved. Read passthrough is a **pure client IDB
  write** of SSR data already received - it issues no server write request. The
  online `/discussion/[id]` route's server-side read-mutations (viewCount+1,
  discussionReads upsert, notifications.isRead) are untouched and never triggered
  by offline/passthrough code.
- **INV-7 (server stateless re: prefs):** the sync endpoint learns enabled
  categories + depth from **query params** the client sends, never from a DB.
  Prefs live only in the client.
- **Reason-set eviction:** never delete `readStatePending` (outbox must still sync).
  Cascade-delete replies + `readStateMerged` only when a discussion's reason set
  is fully empty.
- **Delta reuse:** edits/deletes still flow through the existing
  `(updatedAt,id)` / `(deletedAt,id)` cursors. DV07 only adds **category
  membership** + **read** as reasons and the depth-aware reply backfill.
- **Trigger lines are distinct:** (a) **scheduled curated refresh** is throttled
  by the frequency setting; (b) **read passthrough** writes on every relevant
  browse; (c) **reconnect delta-sync** runs on `online` event as today. They must
  not collapse into one throttled path.
- **No infinite `$effect` loops** ([[svelte-effect-fetch-loop]]): passthrough +
  schedule hooks use `afterNavigate` / guarded `onMount`, never a bare `$effect`
  calling a fetcher that mutates tracked `$state`.

## Scope (six cycles)

- **C01 - Server curated pipeline.** `getDiscussionsList` gains a `sort`
  param (`latest` | `mostViewed` | `mostReplied`, default `latest` = current
  behavior, zero change to existing UI). New `getCuratedDiscussionIds(sort, limit,
readableSlugs)` in `db/dao/sync.ts`. `GET /api/sync/content` accepts query params
  `categories` + `depth` and returns the enabled categories' page-1 ID sets
  (+ existing front/bookmark sets) and their depth-aware reply backfill per
  decision 3. All scoped by `getReadableCategorySlugs`.
- **C02 - Client sync + reasons + eviction (IDB v4).** Dexie `forum-offline` v3→v4:
  add `reasons` + `readUpdatedAt` to the `discussions` record; new
  `replyCacheManifest` store (per-discussion `totalPages`, `pageSize`,
  `cachedRanges`, `complete`). Sync orchestrator tags reasons from the category ID
  sets, maintains `curated.{latest,mostViewed,mostReplied}.ids` in `syncMeta`,
  populates the manifest, and evicts by reason set (delete only when empty).
  Generalize `partialGap` → arbitrary-range gap computation off the manifest.
- **C03 - Settings UI + install gating.** `/profile/offlineReading` (localStorage
  prefs via a typed `offline-prefs.svelte.ts` store; auth-gated, guests redirect).
  Checkboxes for the 3 categories, radio for reply depth, select for refresh
  interval, toggle for read passthrough, master enable toggle. New
  `src/lib/stores/pwa-install.svelte.ts` (match `online.svelte.ts`: `matchMedia(
'(display-mode: standalone)')` / iOS `navigator.standalone`, `beforeinstallprompt`
  / `appinstalled` listeners). Auto-enable once on first installed-PWA launch when
  the pref is still default-off. i18n under `profile.offlineReading.*`
  ([[i18n-duplicate-key-check]] - `offline` top-level key already exists, do not
  collide).
- **C04 - Read passthrough + gap rendering.** `src/lib/offline/passthrough.ts`:
  map online `+page` SSR data (`DiscussionListItem[]` from list pages;
  `discussion + opReply + replies + page + totalPages` from thread pages) to lean
  DTOs and upsert into IDB with reason `'read'` + `readUpdatedAt = now`, ensuring
  referenced authors land in the `users` store. **OP backfill:** when entry page >
  1 and caching is on, fetch + cache the main post (主楼 = earliest reply). Online
  re-entry refreshes the cached thread from the already-fetched SSR load (active
  write-back). `/offline/[id]` renders arbitrary-range gaps from the manifest
  (replaces the single `partialGap` divider).
- **C05 - Schedule + TTL.** Frequency throttle gate on the curated refresh path
  (`lastSyncAt + intervalDays*86400`), interval options 1/2/3/5/7 (default 1).
  Category cleanup diff on each scheduled refresh: append new entrants, drop
  reasons for rows no longer in a category, let delta cursors handle edits. `read`
  reason 30-day TTL: drop `'read'` (then delete if empty) when
  `readUpdatedAt < now - 30d` and no other reason.
- **C06 - Full-system integration audit.** Per [[dv04-audit-loop]] and the DV06
  post-complete lesson (per-cycle audits missed cross-subsystem sync gaps), run a
  final 5-agent audit across **all** DV07 subsystems + their integration with
  DV06 (eviction, read-state outbox, SW, online routes). Loop to 5/5.

## Method

Per [[dv04-audit-loop]]: for each cycle, write `DV07-C[NN]-Journal.md`; each round
launch **5 parallel independent full-audit agents (no role assignment)**;
consolidate into `RV07-C[NN]-Audit-[round].md`; if not 5/5
**UNCONDITIONAL_PASS** (PASS_WITH_NOTES does not count), fix and re-audit; advance
only on 5/5. Gate each round with `bun run check` (0 errors) and `bun run lint`
(exit 0). Run `prettier --write` on every touched doc as the last step before each
re-audit ([[markdown-table-pipe-gotcha]]).

**Orchestration note:** dev and audit work run as sub-agents; the lead only does
macro progress management (dispatch, read verdicts, decide rounds, write
journals) to keep context bounded.

## Artifacts

- `DV07-Plan.md` - this file.
- `DV07-C01-Journal.md` … `DV07-C06-Journal.md` - per-cycle round logs.
- `RV07-C01-Audit-0<N>.md` … `RV07-C06-Audit-0<N>.md` - consolidated round reports.

## Deployment notes

- **Schema migrations:** C01/C02 may add supporting indexes (e.g. on `view_count`,
  `comment_count`) - `bun run db:generate:local` → auto-applies on local libsql
  connect; prod D1 manual via `wrangler d1 execute` ([[prod-d1-migration-manual]]).
  No new tables or columns (prefs are client-side; reasons/manifest are IDB-only).
- **IDB schema bump:** C02 v3→v4 is client-side (Dexie). Existing
  `versionchange`/`blocked` handling in `idb.ts` covers it; a stuck older DB still
  needs a one-time clear ([[offline-debugging-heuristics]]).
- **No new deps.** Reuses `dexie` (DV06). PWA install detection is platform APIs.
- **Testing constraint:** the SW + offline behavior is **prod-only**
  (`import.meta.env.PROD` gate). Verify with `bun run build && bun run preview`,
  not `bun run dev` ([[offline-debugging-heuristics]]).

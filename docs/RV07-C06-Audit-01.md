# RV07 C06 Audit - Round 1 (Full-System Integration)

Method: 5 parallel independent full-audit agents (no roles), each a FULL-system
audit of `git diff 0a2d9cc..HEAD` with a distinct cross-subsystem lens. Per
[[dv04-audit-loop]] / the DV06 post-complete lesson. Plan: `docs/DV07-Plan.md`.

## Verdict

**3/5 UNCONDITIONAL_PASS, 1/5 PASS_WITH_NOTES, 1/5 CONDITIONAL** → fix and re-audit.

| Agent | Lens                                         | Verdict             |
| ----- | -------------------------------------------- | ------------------- |
| 1     | sync data coverage / ghost rows              | PASS_WITH_NOTES     |
| 2     | reason + manifest lifecycle                  | UNCONDITIONAL_PASS  |
| 3     | INV-4 / auth-guest / offline UX              | CONDITIONAL (MAJOR) |
| 4     | invariants / DV06 / IDB upgrade / reactivity | UNCONDITIONAL_PASS  |
| 5     | gates / types / carry-over triage / build    | UNCONDITIONAL_PASS  |

Gates: `bun run check` 0/0 (incl. `tsconfig.sw.json`); `bun run lint` exit 0 (0
type-dupes; 27 informational, none DV07-introduced); `bun test` 82/82 (647 exp);
`bun run build` ✓ (7.9s). Carry-over triage: **14 accept / 0 block**.

## MAJOR finding (must fix)

- **[MAJOR, A3] Decision #5 violation - guests can populate a cache via
  passthrough.** `/` and `/discussions/…` are PUBLIC routes (`userId: user?.id ??
null`). `runPassthrough` gates only on `prefs.enabled && prefs.passthrough`
  (`passthroughEnabled()`), with NO `data.user` check. A guest on an installed PWA
  (whose localStorage auto-enable wrote `enabled:true`) browsing the public home
  populates `db.discussions`/`db.users` from public list pages - exactly what
  decision #5 forbids. INV-4 itself holds (no server write; the curated sync API
  still 401s for guests), but the Decision #5 contract is broken on the
  passthrough path. **Fix:** gate every passthrough hook on the authed session
  (`if (!data.user) return;` before `writeList`/`writeThread` in home, /discussions,
  /category, /profile/discussions, and the thread page) - or centralize an
  auth-aware `passthroughEnabledFor(user)`. Also gate `triggerSync` in
  `+layout.svelte` on `data.user` so guests don't fire a guaranteed-401 sync fetch
  on reconnect.

## MINOR findings (fix alongside)

- **[A1] List-only ghost row.** `writeList` caches a discussion's metadata (reason
  `'read'`) but no replies + no manifest. `/offline` lists it (with "N replies"),
  but `/offline/[id]` shows a generic "empty" body. Honest-gap fix: the reader
  should distinguish "content not cached - only the listing was" (distinct empty
  state) from "never cached" / fully cached. (The list metadata WAS downloaded, so
  caching it is correct; the fix is honest UX, not removing the row.)
- **[A1] `/offline` list sort** lacks the `id` tiebreaker the server applies
  (`desc(discussions.id)`); same-`lastReplyAt` threads can reorder vs the live
  homepage. Cosmetic; one-liner.
- **[A4, accepted carry-over]** `backfillMissingUsers` runs unconditionally every
  sync (pre-existing DV06; O(N) scan) and `passthroughEnabled()` double-reads
  prefs. Non-blocking perf notes - log as **CO-C06-1**.

## Confirmed correct (integration, all lenses)

- **No curated/front/bookmark ghost rows:** `getDiscussionsByIds` +
  `getRepliesForDepth` + `mergeDepthRangesIntoManifests` fully cover the curated
  union (details + depth replies + manifest per ID). `backfillMissingUsers`
  covers authors for all paths. `getReadableCategorySlugs` applied on every server
  select (no private-category leak).
- **Reason + manifest lifecycle** across C02/C04/C05 writers: union via shared
  `REASON_ORDER`; scroll-off/un-bookmark/TTL transitions all correct; eviction
  txn integrity (`readStatePending` never deleted; every store listed).
- **INV-4:** passthrough/manifest/gap/refresh-policy/evict/prefs have zero server
  requests; `/api/sync/content` pure-read; `/api/sync/read-state` writes only
  `discussion_reads`; `/offline/*` stay `ssr=false` with no `+page.server.ts`;
  online read-mutations untouched.
- **DV06 regression** (feature off): byte-identical sync wire + IDB + eviction +
  outbox; IDB v1→v4 upgrade clean (optional `reasons`/`readUpdatedAt`, new store);
  no `$effect` loops; trigger lines distinct.
- **Offline reader** multi-range gap dividers, OP-only hint, missing-user/manifest
  graceful degradation all correct.

Advancing to round 2 with the MAJOR (Decision #5) + the two MINOR honesty/cosmetic
fixes.

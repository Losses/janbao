# DV07 C04 Journal - Read Passthrough + Derived Manifest + Multi-Range Gap Rendering

Method: 5 parallel independent full-audit agents (no roles), loop until 5/5
unconditional PASS. See [[dv04-audit-loop]]. Plan: `docs/DV07-Plan.md`. Built
on C03 (`docs/DV07-C03-Journal.md`, settings UI + install gating COMPLETE
5/5). **C04 base commit: `e5faa25fab707bf4cb5901857860fa4678d2c781`.**

## Pre-audit dev notes

- **`src/lib/offline/passthrough.ts`** - pure client-side writer (INV-4: zero
  server requests; verified by grep - the only "fetcher" in the module is
  `getOfflineDB()`, an IDB open). Two entry points:
  - `writeList(items: DiscussionListItem[])`: maps each list item to a lean
    `CachedDiscussion` (id/title/slug/categorySlug/authorId/commentCount/
    isPinned/createdAt/updatedAt(lastReplyAt ?? createdAt)/lastReplyAt) +
    writes `CachedUser` rows for the discussion author AND the
    lastReplyAuthor (when present). Tags each discussion with reason `'read'`
    (UNION onto existing reasons, never removes others), sets
    `readUpdatedAt = Date.now()`. Bulk-reads prior rows once to carry forward
    `cachedAt` + non-read reasons.
  - `writeThread(input: ThreadPassthroughInput)`: upserts the discussion
    (lean shape + read reason union + readUpdatedAt), upserts `opReply` +
    `replies` as `CachedReply` rows (deduped by id), upserts every distinct
    author AND editor (from `editedBy` + `editedByDisplayName`/`editedByUsername`
    join fields) as `CachedUser` rows, then merges the visited page range
    into the manifest (deliverable 3). Round 2 corrected the page-1 claim:
    only the visited page `[page, page]` is merged; the OP being cached no
    longer auto-claims page 1 (page 1 is claimed only when `page === 1`,
    i.e. its full reply set is present).
  - **Gating**: every call early-returns unless
    `readOfflinePrefs().enabled && readOfflinePrefs().passthrough`. The
    route hooks also check `navigator.onLine`. Guests never reach the authed
    routes anyway (decision #5).
  - **Epochish time tolerance**: `Date | number` accepted everywhere; a
    heuristic (`> 1e12` ⇒ ms) normalizes to seconds. Drizzle timestamp-mode
    Dates on the client and already-converted epoch numbers both work.
- **OP backfill** - verified the thread `+page.server.ts` already fetches the
  OP unconditionally (line 115, before the page-specific `repliesStream`),
  so `opReply` is returned on ALL pages. No server change needed for the
  "ensure OP is cached when entry page > 1" requirement - the load already
  provides it. The two additive changes to `+page.server.ts` are
  read-only/no-behavior-change: exposing `replyPageSize: limit` (the value
  the route already computes for its own pagination) and adding
  `editedBy: replies.editedBy` to both the OP + paginated-replies selects
  (the `editors` alias is already joined; this id was simply not selected
  before, and the online renderer ignores it). The offline renderer is
  untouched by these.
- **Manifest reconciliation (resolves CO-C02-1 + lost updates)** -
  `src/lib/offline/manifest-recompute.ts`:
  - **Key design decision**: page numbers are WRITER-SUPPLIED, not derived
    from cached reply contents. A reply's row carries `createdAt` and `id`
    but not its absolute position in the thread; a non-contiguous cached
    subset (e.g. sync depth firstLast = page 1 + last page) cannot be
    bucketed back to absolute page numbers from createdAt alone because
    the cached stream is contiguous even when the underlying pages are not.
    So the manifest is MERGED from writer-reported page ranges.
  - `mergePageRange(input)`: pure function. Unions a writer-reported page
    range into the manifest's existing ranges, normalizes + coalesces
    (overlapping, adjacent, unordered), clamps to `[1, totalPages]`, and
    re-evaluates `complete` against `totalPages = ceil((commentCount-1) /
pageSize)` (commentCount includes the OP; the thread route derives
    totalPages from non-OP replies, so this mirrors that).
  - `recomputeManifestForDiscussion(db, discussionId, commentCount,
pageSize, cachedRange)`: reads the prior manifest row, checks whether
    ANY reply for the discussion is still cached (defense-in-depth: if all
    replies were evicted, deletes the manifest row), then merges the range
    and persists. This is the "derived from the replies store" part - the
    replies-store read drops ranges whose backing replies have been evicted
    (the manifest can never claim a page that isn't actually cached).
  - Called from BOTH writers: the C02 sync orchestrator's new
    `mergeDepthRangesIntoManifests` iterates `computeCachedRanges(depth,
totalPages, pageSize, commentCount)` per curated/front/bookmark
    discussion and calls the helper once per depth-derived range; the C04
    passthrough `writeThread` calls it with the visited page (and page 1
    when opReply backfills). Idempotent: re-merging the same range is a
    no-op. The pre-C04 `populateReplyManifests` (depth-only, overwriting)
    is removed - its lost-update failure mode is what this unifies.
  - Structural `ManifestRecomputeDb` interface (named, not inline per type
    rules) accepts a ForumOfflineDB-compatible subset so the helper is
    testable without Dexie. The pure `mergePageRange` is unit-tested.
- **Route wiring** - `onMount` + `afterNavigate` in every relevant
  `+page.svelte` (no bare `$effect` per [[svelte-effect-fetch-loop]]):
  - Thread page (`discussion/[discussionId]/[slug]/[[page=page]]`):
    `writeThread` with the page data snapshot. `afterNavigate` re-runs on
    in-app page flips (the component stays mounted across pagination).
  - Home (`/`), `/discussions/[[page=page]]`, `/category/[categorySlug]/
[[page=page]]`, `/profile/discussions/[userId]/[userSlug]`:
    `writeList(data.discussions)`. One call each, with `afterNavigate` for
    pagination.
  - All hooks read the snapshot at the right lifecycle point and are
    best-effort (IDB hiccups are logged + swallowed, never break the
    online view).
- **Gap rendering** (`src/routes/offline/[discussionId]/+page.ts` +
  `+page.svelte`):
  - Removed the legacy `partialGap` single-divider path (the multi-range
    view subsumes it; no dead code).
  - `ReplyGapSummary` now carries `pageSize`, `totalPages`, and
    `cachedRanges` (echoed from the manifest) so the renderer can place
    dividers at exact block boundaries without re-deriving from
    commentCount.
  - Round 2 rewrote the renderer around a pure `computeGapPlacements`
    helper (`src/lib/offline/gap-placement.ts`): for each gap it sets
    `beforeIndex = pagesBefore * pageSize` (cumulative pages of ranges with
    `end < gap.start`), clamped to `cachedReplyCount`; the renderer inserts a
    divider at each such index. OP-only-cached + uncached pages emit a
    trailing `restNotCached` hint. 9 pinned-shape tests. No dividers when
    no gaps / no manifest (no regression vs DV06 for fully-cached threads).
  - i18n keys added under `offline.reader.*` in BOTH `en.json` +
    `zh-CN.json` ([[i18n-duplicate-key-check]] - grepped first, no
    collision): `gapRange` ("Pages {start}-{end} not cached (about {count}
    replies)" / "Pages {start}-{end} not cached (about {count} replies)") and
    `gapSingle` ("Page {page} not cached (about {count} replies)" /
    "Page {page} not cached (about {count} replies)"). The
    `TranslationDict` is inferred from `en.json`, so the keys are typed
    end-to-end without a manual interface.

## Invariants preserved

- **INV-4 (no false read)**: passthrough issues ZERO server requests
  (verified by grep - only `getOfflineDB()` is called). The two
  `+page.server.ts` changes (exposing `replyPageSize`, selecting
  `editedBy`) are read-only additive fields; the online read-mutation
  sequence (viewCount+1, discussionReads upsert, notifications.isRead) is
  untouched and never triggered by passthrough code.
- **No `$effect` loops** ([[svelte-effect-fetch-loop]]): every passthrough
  hook is `onMount` or `afterNavigate`. No reactive effect calls a writer
  that mutates tracked state.
- **DV06 / C02 / C03 behavior gate**: passthrough early-returns when
  `!enabled || !passthrough`, so the online path is byte-identical to
  before DV07. The `!enabled` orchestrator path still sends
  `categories= + depth=firstLast` (DV06 wire shape).
- **Reason-set integrity**: `withReadReason` only ever UNIONs `'read'`;
  the orchestrator's `applyReasonSets` is unchanged and never touches
  `'read'`. The deterministic `REASON_ORDER` mirrors the orchestrator's
  so a passthrough write doesn't churn the reasons array identity.
- **Type rules (zero tolerance)**: all new types are named interfaces;
  `interface` over `type` for object shapes; the structural
  `ManifestRecomputeDb` shape is decomposed into named interfaces
  (`ReplyWhereApi`, `ReplyCacheManifestStore`, etc.) per the
  no-inline-typing rule. `Epochish = Date | number` is a union (type-only).

## Gates

- `bun run check`: 0 errors / 0 warnings / 1272 files.
- `bun run lint`: exit 0 (prettier clean, eslint clean, similarity-ts
  type-dupes 0 - 27 informational pairs, all pre-existing).
- `bun test`: 48/48 pass (manifest 14 + manifest-recompute 12 + carry-over
  22). New pure-function tests pin `mergePageRange`'s union/coalesce/
  clamp behavior + the multi-range `computeReplyGaps` output shape.

## Carry-overs

- **CO-C04-1** The manifest's `cachedRanges` are writer-supplied absolute
  page numbers, NOT derived from cached reply contents. This is correct
  but means a row whose replies were cached by an unknown writer (e.g. a
  future migration) would have no manifest. Acceptable: every current
  writer reports its ranges.
- **CO-C04-2** `recomputeManifestForDiscussion`'s defense-in-depth replies
  check uses a full `where('discussionId').equals().toArray()` count. For
  very large cached threads this is O(N) per write; could be `.count()`
  instead, but Dexie's count on a non-unique index is itself a scan, so
  the difference is marginal.
- **CO-C04-3** The gap-renderer's block-allocation assumes cached replies
  are sorted by id and that the manifest's page slots correspond 1:1 to
  reply positions. A thread with deleted replies (gaps in the id
  sequence) may slightly misplace a divider, but the label still shows
  the correct absolute page range, so the information is never wrong.

## Round 1

- 5 agents. Verdict: **3/5 UNCONDITIONAL_PASS, 1/5 PASS_WITH_NOTES, 1/5 FAIL**.
- The integration skeptic caught writer/consumer bugs the per-file audits missed:
  **[MAJOR A4-1]** passthrough over-reported page 1 (merged `[1,1]` whenever OP
  present + page>1); **[MAJOR A4-2]** renderer `repliesPerRange` pre-allocation
  mis-placed dividers for multi-range manifests; **[MED A4-4]** thread passthrough
  hardcoded `lastReplyAt: null`; **[MINOR]** `totalPages` off-by-one (orchestrator
  used `ceil(commentCount/pageSize)` but commentCount includes the OP).
- Fixes shipped in `a7df7e1`. See `RV07-C04-Audit-01.md`.

## Round 2

- 5 agents. Verdict: **5/5 UNCONDITIONAL_PASS**.
- All four findings fixed + verified: honest page-1 claim (only `[page,page]`);
  renderer rewritten via pure `computeGapPlacements` (9 pinned-shape tests, OP-only
  `restNotCached` hint); `lastReplyAt` selected + passed; shared `computeTotalPages`
  (OP-excluding) everywhere; dead syncMeta writes removed.
- Carry-overs: CO-C04-1 (tombstoned reply within a cached page - renderer should
  tolerate a missing row), CO-C04-4 (`computeGapPlacements` assumes normalized
  ranges, mitigated upstream by `normalizeRanges`). See `RV07-C04-Audit-02.md`.
- Gates: check 0/0, lint exit 0, `bun test` 57/57.

**C04 COMPLETE 5/5.** Advancing to C05 (schedule + TTL).

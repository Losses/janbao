# RV07 C04 Audit - Round 2

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff e5faa25..HEAD` (commits 7612ab3 + a7df7e1). Round 1 was 3/5 + 1 FAIL;
fixes shipped in `a7df7e1`. Plan: `docs/DV07-Plan.md`. See [[dv04-audit-loop]].

## Verdict

**5/5 UNCONDITIONAL_PASS** → C04 advances.

| Agent | Start file                 | Verdict            |
| ----- | -------------------------- | ------------------ |
| 1     | passthrough.ts             | UNCONDITIONAL_PASS |
| 2     | gap-placement.ts (skeptic) | UNCONDITIONAL_PASS |
| 3     | renderer (+page.svelte)    | UNCONDITIONAL_PASS |
| 4     | integration skeptic        | UNCONDITIONAL_PASS |
| 5     | sync-orchestrator + types  | UNCONDITIONAL_PASS |

Gates: `bun run check` 0 errors/0 warnings; `bun run lint` exit 0 (0 type-dupes);
`bun test` 57/57 (9 gap-placement + 26 manifest/manifest-recompute + carry-over).

## Round-1 fixes confirmed correct (all 5 agents)

- **[MAJOR A4-1 → fixed] honest page-1 claim** (`passthrough.ts:396-408`):
  `writeThread` now claims only `[page, page]` (clamped to totalPages); the spurious
  `[1,1]` on `page>1` is removed. Caching the OP alone claims no page; `[1,1]` only
  when `page===1` (full page-1 set). Visiting page 5 → manifest `[5,5]` only.
- **[MAJOR A4-2 → fixed] renderer placement** (`gap-placement.ts` + `+page.svelte`):
  new pure `computeGapPlacements` walks gaps, sets `beforeIndex = pagesBefore *
pageSize` (cumulative pages of ranges with `end < gap.start`), clamped to
  `cachedReplyCount`. 9 pinned-shape tests (firstLast, all under/over-cap, single
  visited page, OP-only, 3-range, evicted-range, stale-clamp). Renderer consumes it
  via `$derived.by` (no `$effect` loop); OP-only + all-evicted → `restNotCached`
  trailing hint (resolves CO-C04-3).
- **[MED A4-4 → fixed] `lastReplyAt`** selected in thread load (`+page.server.ts:50`)
  - passed through (`+page.svelte:95`); no more null hardcode.
- **[MINOR → fixed] `computeTotalPages(commentCount, pageSize)` = `ceil(max(0,
commentCount-1)/pageSize)`** shared across orchestrator, manifest-recompute,
  renderer (OP-excluding, matches the thread route's OP-excluded count).
- **Dead writes removed:** orchestrator no longer writes `partialReplyDiscussions` /
  `replyPageSize` syncMeta (grep-confirmed unread).

## Carry-overs (informational, non-blocking)

- **CO-C04-1** A reply tombstoned within an otherwise-cached page leaves the
  manifest claiming that page cached (passthrough-only discussions aren't
  reconciled against tombstones). Rare; the **offline reply renderer should
  tolerate a missing reply row** (deletion placeholder). Log for a follow-up.
- **CO-C04-4** `computeGapPlacements` assumes its `cachedRanges` input is sorted +
  non-overlapping (doesn't re-validate). Mitigated upstream by `normalizeRanges` in
  `computeReplyGaps`. A defensive normalize inside the helper would harden it.

## Confirmed correct (all 5)

- **INV-4:** passthrough issues zero server requests (grep-confirmed); thread load
  changes read-only/additive; `/offline/[id]` stays `ssr=false`, no `+page.server.ts`.
- Manifest union model honest across both writers (sync depth + passthrough
  visited-page); no false page claims; no lost updates.
- Gating (`!enabled || !passthrough` → no-op, DV06 preserved); guests can't reach
  authed routes.
- Reason union (`'read'` added, never removes others; `readUpdatedAt` set);
  orchestrator never touches `'read'`; eviction reason-set-driven; `readStatePending`
  never deleted.
- OP cached on all pages; route wiring (`onMount`/`afterNavigate`, no `$effect`).
- Types (named interfaces); i18n parity en↔zh-CN, property-path access.

C04 complete. Advancing to C05 (schedule + TTL).

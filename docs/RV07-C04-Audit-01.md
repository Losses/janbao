# RV07 C04 Audit - Round 1

Method: 5 parallel independent full-audit agents (no roles). Cumulative change:
`git diff e5faa25..HEAD` (commit 7612ab3). Plan: `docs/DV07-Plan.md`.
See [[dv04-audit-loop]].

## Verdict

**3/5 UNCONDITIONAL_PASS, 1/5 PASS_WITH_NOTES, 1/5 FAIL** → fix and re-audit.

| Agent | Start file                   | Verdict            |
| ----- | ---------------------------- | ------------------ |
| 1     | passthrough.ts (INV-4)       | UNCONDITIONAL_PASS |
| 2     | manifest-recompute.ts (pure) | UNCONDITIONAL_PASS |
| 3     | gap rendering                | PASS_WITH_NOTES    |
| 4     | integration skeptic          | FAIL               |
| 5     | sync-orchestrator + types    | UNCONDITIONAL_PASS |

Gates: `bun run check` 0/0; `bun run lint` exit 0 (0 type-dupes); `bun test` 48/48.

The integration skeptic caught writer/consumer bugs the per-file/pure-helper
audits missed — exactly the multi-angle value. The pure `mergePageRange` logic
(A2) is correct; the defects are in how writers FEED it and how the renderer
CONSUMES it.

## MAJOR findings (must fix)

- **[MAJOR, A4-1] Over-report page 1.** `passthrough.ts` merges `[1,1]` into the
  manifest whenever `opReply` is present and `page > 1`. Since the thread load
  returns `opReply` on every page, visiting page 5 caches only the OP + page-5
  replies yet claims page 1 fully cached. Page 1 holds OP + up to `pageSize-1`
  other replies; claiming it with only the OP violates the "honestly represent
  gaps" requirement. **Fix:** only claim the page actually visited — merge
  `[page, page]`; claim `[1,1]` only when `page === 1` (full page-1 set present).
  The OP being cached does not, by itself, claim any page.
- **[MAJOR, A4-2] Renderer divider placement.** `offline/[id]/+page.svelte`
  pre-allocates `repliesPerRange[0] = pages*pageSize - 1` and slices the cached
  replies by those counts; for multi-range manifests (e.g. `firstLast`
  `[{1,1},{10,10}]`) the divider lands at the wrong offset (or not at all) and
  replies get attributed to the wrong block. **Fix:** rewrite the placement to
  not assume each range holds exactly `pages*pageSize` replies — group cached
  replies by manifest range and insert dividers at range boundaries. Extract the
  placement into a pure, testable helper and pin multi-range shapes.

## MED/MINOR findings (fix alongside)

- **[MED, A4-4 / A5] `lastReplyAt: null` hardcoded** in the thread passthrough
  input; the real `discussions.lastReplyAt` exists but is dropped → the cached
  row's `lastReplyAt` is nulled on every thread visit (corrupts the legacy v3
  retention cutoff). **Fix:** select `lastReplyAt` in the thread load + pass it.
- **[MINOR, A3-1 / A5-1] `totalPages` off-by-one.** Orchestrator uses
  `ceil(commentCount/pageSize)` but `commentCount` includes the OP while the
  paginated reply stream excludes it (thread route: `ceil(totalRepliesCount/
limit)`). `recomputeManifestForDiscussion` uses the correct OP-excluding
  formula, so it's currently clamped-safe but fragile. **Fix:** share one
  `computeTotalPages(commentCount, pageSize) = ceil(max(0, commentCount-1)/
pageSize)` across orchestrator + recompute + renderer + C02 `computeCachedRanges`.

## Carry-overs (informational, log)

- **CO-C04-1** A reply tombstoned within an otherwise-cached page leaves the
  manifest claiming that page cached (passthrough-only discussions are never
  reconciled against tombstones — orchestrator only re-merges curated/front/
  bookmark). Rare; the **offline reply renderer should tolerate a missing reply
  row** (show a deletion placeholder). Log for a follow-up.
- **CO-C04-2** `recomputeManifestForDiscussion`'s replies-presence defense uses
  `.toArray()` (O(N)) vs `.count()` — marginal (Dexie count on a non-unique index
  is itself a scan). No action.
- **CO-C04-3** OP-only-cached + multi-page thread renders no divider (no reply
  anchor) — the renderer rewrite should show a "rest not cached" hint after the OP.
- **[A4-integration] Dead syncMeta writes:** `partialReplyDiscussions` +
  `replyPageSize` are still written but no longer read after `partialGap` removal.
  Remove the dead writes.

## Confirmed correct (all 5)

- **INV-4:** passthrough issues zero server requests (grep-confirmed; only IDB
  writes from SSR data). Thread `+page.server.ts` changes are read-only/additive
  (`replyPageSize`, `editedBy`); online read-mutations untouched; `/offline/[id]`
  stays `ssr=false` with no `+page.server.ts`.
- Manifest union model (pure `mergePageRange`) correct; no lost updates between
  sync + passthrough writers (sequential read-modify-write).
- Gating: passthrough no-ops when `!enabled || !passthrough` (DV06 preserved);
  guests can't reach authed routes.
- Reason union (`'read'` added, never removes others); `read`/`readUpdatedAt`
  owned solely by passthrough; orchestrator never touches `'read'`.
- OP cached on all pages (load returns it unconditionally); route wiring
  (`onMount`/`afterNavigate`, no `$effect` loop) across thread + 4 list pages.
- Types (named interfaces); tests for the pure helper.

Advancing to round 2 with the 2 MAJOR + 2 MED/MINOR fixes + carry-over cleanups.

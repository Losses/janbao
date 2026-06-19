# RV07 C06 Audit - Round 2 (Full-System Integration)

Method: 5 parallel independent full-audit agents (no roles), each a FULL-system
re-audit of `git diff 0a2d9cc..HEAD` (entire DV07). Round 1 was 3/5 + 1 MAJOR;
fixes shipped in `de6d1bc`. Plan: `docs/DV07-Plan.md`. See [[dv04-audit-loop]].

## Verdict

**5/5 UNCONDITIONAL_PASS** → **DV07 COMPLETE.**

| Agent | Lens                                | Verdict            |
| ----- | ----------------------------------- | ------------------ |
| 1     | guest gate (Decision #5)            | UNCONDITIONAL_PASS |
| 2     | reader honesty + sort               | UNCONDITIONAL_PASS |
| 3     | regression skeptic                  | UNCONDITIONAL_PASS |
| 4     | integration re-hunt                 | UNCONDITIONAL_PASS |
| 5     | gates / types / carry-overs / build | UNCONDITIONAL_PASS |

Gates: `bun run check` 0 errors/0 warnings (1277 files, incl. `tsconfig.sw.json`);
`bun run lint` exit 0 (0 type-dupes; 29 informational, none DV07-introduced);
`bun test` 82/82 (647 expectations); `bun run build` ✓ (~6–8s). Carry-over triage:
**14 accept / 0 block.**

## Round-1 fixes confirmed correct (all 5 agents)

- **[MAJOR → fixed] Decision #5 guest-cache leak.** Centralized
  `passthroughEnabledFor(user: AuthedUserRef | null)` in `passthrough.ts` =
  `!!user && enabled && passthrough` — the ONE enforcement point. All 5 passthrough
  callers (home, /discussions, /category, /profile/discussions, thread page) gate
  on `data.user`; `+layout.svelte` gates `triggerSync` on `data.user`. A guest on
  an installed PWA may have `enabled:true` in localStorage (auto-enable) but every
  passthrough writer early-returns AND the curated sync API 401s → **guest end-
  state fully inert**. Authed users on public routes still cache (correct).
  Defense-in-depth: writers still re-check `passthroughEnabled()` internally.
- **[MINOR → fixed] honest list-only state.** `listingOnly = !!discussion &&
replies.length === 0 && manifestRow == null`; reader shows distinct
  `offline.reader.listingOnly` (en + zh-CN) instead of generic empty. No-row case
  keeps `notCached`. List-only rows stay on `/offline` (listing was downloaded).
- **[MINOR → fixed] `/offline` sort** ends in `id` (mirrors server `desc(id)`).

## Confirmed correct (full-system, all lenses)

- **No ghost rows:** curated/front/bookmark union fully covered (detail + depth
  replies + manifest per ID); `backfillMissingUsers` covers all paths;
  `getReadableCategorySlugs` on every server select (no private-category leak).
- **Reason/manifest/eviction lifecycle** across C02/C04/C05: union via shared
  `REASON_ORDER`; transitions correct; eviction txn integrity;
  `readStatePending` never deleted; `replyCacheManifest` cleared on eviction.
- **INV-4:** zero server requests in passthrough/manifest/gap/refresh/evict/prefs;
  `/api/sync/content` pure-read; `/api/sync/read-state` writes only
  `discussion_reads`; `/offline/*` stay `ssr=false`; online read-mutations untouched.
- **DV06 regression** (feature off): byte-identical sync wire + IDB + eviction +
  outbox; IDB v1→v4 upgrade clean; no `$effect` loops; trigger lines distinct.
- **Cross-cycle consistency:** `computeTotalPages` / `REASON_ORDER` /
  `readUpdatedAt`-seconds consistent everywhere (prior round-1 bug classes closed).

## Final carry-overs (all ACCEPT — none hide a defect)

CO-C01-1..3, CO-C02-1..3, CO-C03-1..2, CO-C04-1..4, CO-C05-1, CO-C06-1 — perf &
hygiene follow-ups with documented mitigations (e.g. `partialReplyDiscussions`
plumbed server→wire but unread client-side since the manifest is authoritative;
`backfillMissingUsers` O(N) scan pre-existing DV06; `computeGapPlacements`
assumes normalized input, mitigated upstream by `normalizeRanges`).

**DV07 COMPLETE 5/5 across all six cycles.**

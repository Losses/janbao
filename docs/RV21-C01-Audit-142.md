# RV21-C01 Audit 142 (R142)

**Date:** 2026-08-06. **Round:** R142 (independent audit of the R141 fix state).
**Votes:** BLOCK. **Counter after: 0/5.**

## Outcome

The R141 fix's three dual-clause citation edits (mobile-pager:24-33,
offline-back-swipe:14-18, orchestrator:4490 + 4828-4832) are accurate and correctly
applied. Two residual defects found:

- **F1:** the R141 fix at `orchestrator:4758-4760` introduced a NEW mechanism
  inaccuracy while fixing an old one (target cited as strict `#tabIndexFor` while
  the publication actually sources `toIdx` via `inputs.toTabIndex` = loose
  `getCurrentTabIndex` for non-bidi backward).
- **F2:** a real correctness + §5 violation caused by the same source/target
  mechanism divergence as F1, manifesting as a morph snap on the reachable
  `/offline/bookmarks -> /offline` back-swipe.

Gates green: `bun run check` 0/0, `bun run lint` exit 0,
`bun test src/lib/stores src/lib/utils` 398/0.

## F1 (MEDIUM, comment-accuracy, R141 regression) -- `orchestrator:4758-4760` claims target uses strict `#tabIndexFor`; the publication actually uses loose `getCurrentTabIndex` for both endpoints in Deep-page mode backward

**Site:** `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:4755-4762` (the
`#republishToPager` Deep-page mode docstring, sub-case 2). R141 rewrote this from:

```
*      clause in `backMorphValue` below). Both endpoints resolve to
*      a tab via `#tabIndexFor`, so the drag is tab-to-tab on a
```

to:

```
*      clause in `backMorphValue` below). Both endpoints resolve to a
*      tab (the source via loose `getCurrentTabIndex` at mount, the
*      target via strict `#tabIndexFor`), so the drag is tab-to-tab on a
```

The R141 fix correctly identified that the SOURCE uses loose `getCurrentTabIndex`
(via `inputs.fromTabIndex = getCurrentTabIndex(fromPathname)` at
`NavPipelineHost.svelte:379`), but it incorrectly paired this with "the target via
strict `#tabIndexFor`". The PUBLICATION's target index for a non-bidi backward
gesture is sourced via `inputs.toTabIndex`, which `NavPipelineHost.svelte:380` also
sets to `getCurrentTabIndex(resolvedLeftHref)` (loose pill-map), and `#beginGesture:1974-1979`
propagates this unchanged into `#gestureToTabIndex` for non-bidi backward:

```ts
const toTabIndex =
	direction === 'backward'
		? inputs.bidirectional === true
			? this.#tabIndexFor(to) // bidi: strict
			: inputs.toTabIndex // non-bidi: loose (inputs.toTabIndex = getCurrentTabIndex)
		: this.#tabIndexFor(to); // forward: strict
```

So in Deep-page mode (non-bidi) backward, BOTH `fromIdx` AND `toIdx` are loose
`getCurrentTabIndex` values, and the publication's `(fromIdx >= 0 && toIdx >= 0)`
clause is evaluated on loose pill-map indices for both endpoints.

The "target via strict `#tabIndexFor`" framing matches the SETTLE ARM's
`backMorphIsNull` computation (`orchestrator:3494-3496`, which uses
`isTabRootPath(back)` for the target), NOT the publication. R141 appears to have
conflated the two computations when rewriting this comment.

**Reachable empirically** (verified via `bun -e`):

```
getCurrentTabIndex('/offline') === 0          # pill-map (loose)
#tabIndexFor('/offline')         === -1       # strict (isTabRootPath = false)
isTabRootPath('/offline')        === false
```

For the cited example `/offline -> /` the loose and strict values agree for the
target (`/` is both a strict tab root and pill-maps to 0), so the example's
_conclusion_ (`backMorph: null`) holds; but the cited mechanism is wrong for the
publication. A maintainer reading this docstring would expect the publication's
target index to be `#tabIndexFor(to)`, which for any non-strict-tab-root
pill-mapped target (e.g. `/offline` itself as a back-target of `/offline/bookmarks`)
returns -1 and would yield `backMorph = raw`, when in fact the publication yields
`backMorph = null` via the loose pill-map. This is the same shape as F2 below.

**Fix:** change "the target via strict `#tabIndexFor`" to "the target via loose
`getCurrentTabIndex` (`inputs.toTabIndex`)" so the comment matches the publication
code path for non-bidi backward (the only shape that reaches Deep-page mode).

## F2 (HIGH, correctness + §5 violation) -- publication vs settle-arm `backMorphIsNull` divergence for non-bidi backward to a non-strict-tab-root pill-mapped target

**Sites:**

- Publication: `orchestrator:4806, 4832-4833` (`toIdx` and `backMorphValue`).
- Settle-arm classification: `orchestrator:3494-3496` and `:2760-2763`
  (`backMorphIsNull`).

The publication's null condition is `(bidirectional && !targetIsDeepPage) ||
(fromIdx >= 0 && toIdx >= 0)`. For a non-bidi backward gesture, `toIdx` resolves to
`inputs.toTabIndex` (loose pill-map), as traced in F1. The settle arm's
`backMorphIsNull` for the same shape uses `isTabRootPath(back)` (strict). These
diverge for any non-bidi backward whose target pill-maps but is NOT a strict tab
root.

**Reachable case:** `/offline/bookmarks -> /offline`.

- `/offline/bookmarks`'s static `leftHref` is `/offline`
  (`src/routes/offline/bookmarks/+page.svelte:42`). On a first-time direct visit
  (or any visit where `previousEntryPathname()` is null or equals `/offline`),
  `resolvedLeftHref === '/offline'`, so `inputs.backTarget === '/offline'` and
  `inputs.toTabIndex === getCurrentTabIndex('/offline') === 0`.
- A backward gesture on `/offline/bookmarks` targets `inputs.backTarget === '/offline'`
  (per `#beginGesture:1881-1886` non-bidi branch).
- During the drag, the publication evaluates:
  - `fromIdx = inputs.fromTabIndex = getCurrentTabIndex('/offline/bookmarks') = 0`
  - `toIdx = #gestureToTabIndex = inputs.toTabIndex = getCurrentTabIndex('/offline') = 0`
    (pill-map; the bidi `#tabIndexFor` branch at `:1977` is NOT taken because
    `inputs.bidirectional === false`)
  - `(false && ...) || (0 >= 0 && 0 >= 0) = true` → **`backMorph = null`**
- At release, the settle arm evaluates:
  - `(false && ...) || (0 >= 0 && isTabRootPath('/offline'))`
  - `isTabRootPath('/offline') === false`
  - → **`backMorphIsNull = false`**
  - → `dragMorphWasStatic = targetIsSearch || (false && !isCenterTabRoute) = false`
  - → `startMorph = #dragMorphAtAnchorOrRaw(true, raw_release) = 1 - raw_release`

The Header's drag-branch `bm === null` fallback (`Header.svelte:267-269`) returns
`currentHasTabs ? 1 : 0 = 1` for `/offline/bookmarks` (which pill-maps so
`currentHasTabs === true`). The settle's `startMorph = 1 - raw_release` (e.g.
`0.5` at the typical 0.5 commit threshold). At the drag-to-settle handoff the morph
**snaps from 1 to `1 - raw_release`** in one rAF frame, a §5 violation.

**Verified empirically** (simulated publication + settle for three offline LIST
backward cases via `bun -e`):

```
/offline -> /               (e2e-tested):       publication null, settle backMorphIsNull true   → consistent (no snap)
/offline/bookmarks -> /offline (NOT e2e-tested): publication null, settle backMorphIsNull false  → DIVERGENT (snap 0.5)
/offline/activity -> /                          : publication null, settle backMorphIsNull true   → consistent
```

A full gesture trace at `raw_release = 0.5`:

```
Drag morph at release (bm===null fallback, no anchor):  1
Settle startMorph    (#dragMorphAtAnchorOrRaw, no anchor): 0.5
*** SNAP at drag-to-settle handoff: 0.5 ***
```

A ~0.5 morph snap at the release handoff is the same shape as the original R4-A F1
`/offline -> /` continuity bug (~26px / ~119deg snap), but on the untested sibling
target. The existing `e2e/offline-back-swipe.spec.ts` only covers `/offline -> /`
(target `/` IS a strict tab root, so pill-map and strict agree and the bug does not
fire); `/offline/bookmarks -> /offline` is uncovered.

**Reconciliation with the audit's established facts.** This finding appears to
contradict two of the prompt's established facts:

- Fact 5: "`backMorph null = (bidirectional && !targetIsDeepPage) || (fromIdx>=0 &&
toIdx>=0)` - bidi uses `tag==='tab'`, non-bidi uses strict `isTabRootPath`."
- Fact 7: "`#dragMorphAtSettleTakeover` uses `backMorphIsNull` from the publication's
  null condition."

The "non-bidi uses strict isTabRootPath" half of fact 5 accurately describes the
SETTLE ARM's `backMorphIsNull` second clause (`inputs.fromTabIndex >= 0 &&
isTabRootPath(back)`), but NOT the PUBLICATION's `toIdx` source for non-bidi
backward, which is `inputs.toTabIndex` (loose pill-map). Fact 7's "uses
`backMorphIsNull` from the publication's null condition" asserts a consistency that
does not hold for the cited reachable case. The publication and the settle-arm
classification were consistent before R137 F1 (when the helper used loose
`isTabToTab`); R137 F1 changed the helper to strict `isTabRootPath` to track the
publication's strict `#tabIndexFor` for the BIDI case, but the publication's NON-BIDI
backward path actually uses `inputs.toTabIndex` (loose), so R137 F1's "match the
publication" justification did not hold for the non-bidi backward shape.

The contradiction resolves in one of two ways, both of which are real defects:

- **(a) Fact 5 is the intended behavior.** The publication should use strict
  `#tabIndexFor(to)` for non-bidi backward (matching the bidi / forward branches).
  Then `#beginGesture:1978` is buggy - it should read `this.#tabIndexFor(to)` not
  `inputs.toTabIndex`. The settle arm is correct. The fix is one line in
  `#beginGesture`.
- **(b) The publication code is correct as-is** (non-bidi backward uses
  `inputs.toTabIndex` because NavPipelineHost's mount-time
  `getCurrentTabIndex(resolvedLeftHref)` is the canonical back-target tab index).
  Then fact 5 is a simplification that is wrong for non-bidi backward, and the
  settle-arm `backMorphIsNull` is buggy - its second clause should mirror the
  publication's pill-map check (`inputs.fromTabIndex >= 0 && inputs.toTabIndex >= 0`)
  rather than `isTabRootPath(back)`. The fix is in `backMorphIsNull` at both call
  sites.

Either way the publication and the settle-arm classification disagree for the cited
case, `dragMorphWasStatic` mis-classifies the shape (false when the publication
actually nulled `backMorph`), the settle captures the wrong `startMorph`, and the
morph snaps at the drag-to-settle handoff (§5 violation). The `bun test src/lib/...`
gate passes because the bug is gated on a navigation pattern no unit test exercises;
`bun run check` / `bun run lint` are type / lint only.

**Severity HIGH** because this is a real user-visible §5 violation (a one-frame
morph snap on a reachable navigation pattern), not a comment-accuracy issue.

**Suggested investigation:** add an e2e test that drives `/ -> /offline ->
/offline/bookmarks` then back-swipes on `/offline/bookmarks`, asserts the
multi-signal `rootLayerTy` / `burgerRot` per-frame jumps stay under the
`offline-back-swipe.spec.ts` threshold (15px / 35deg) across the release handoff.
The bug should reproduce as a ~26px / ~119deg snap (same shape as R4-A F1, the
original `/offline -> /` continuity bug, but on the untested sibling target).

## Sampling (no defect)

- The R141 fixes at `mobile-pager.svelte.ts:24-33` (split by host type with both
  clauses cited), `offline-back-swipe.spec.ts:14-18` (both clauses cited),
  `orchestrator:4490-4492` (both clauses cited), and `orchestrator:4828-4832`
  (both clauses cited with bidi `/offline` clarification) are accurate.
- The mobile-pager grammar concern ("where both morph stays" suspected at
  mobile-pager:32-33) is NOT a defect - the R141 edit actually produced "where the
  morph stays" (singular, grammatical), verified by direct re-read.
- Header.svelte morph derivation (`:155-269`) and searchProgress derivation
  (`:580-619`): bm === null branches use `dragMorphAnchor` correctly; tab-to-tab
  framing matches the audit's "tab-to-tab = both endpoints pill-map" fact.
- `#dragMorphAtSettleTakeover` docstring (`:3608-3640`): dragMorphWasStatic shapes
  enumeration is accurate; both host types listed with correct mechanism per host.
- The Header `bm === null` drag fallback (`:255-269`) and the search axis's
  `backMorph === null` hold branch (`:590-601`) describe "tab-to-tab re-grab on a
  non-centerTab host" without citing a specific clause mechanism - defensible
  high-level summary per the "tab-to-tab = both endpoints pill-map" fact.
- `reproduce-dv20-drag-sync.spec.ts:96-99` and `messages-back-swipe.spec.ts:2246-2249`
  describe the publication rule consistent with the audit's established facts.

## Disposition

Counter after R142: 0/5. Two confirmed defects, both rooted in the same
publication-vs-settle-arm mechanism divergence for non-bidi backward to
non-strict-tab-root pill-mapped targets:

- F1 (MEDIUM, comment-accuracy, R141 regression): orchestrator:4758-4760 - R141
  rewrote "Both endpoints resolve to a tab via `#tabIndexFor`" to "the source via
  loose `getCurrentTabIndex` at mount, the target via strict `#tabIndexFor`",
  fixing the source but introducing a new error: the target in the publication is
  ALSO loose (via `inputs.toTabIndex = getCurrentTabIndex`), not strict. The
  asymmetric framing matches the settle-arm `backMorphIsNull`, not the publication.
- F2 (HIGH, correctness + §5): publication and settle-arm `backMorphIsNull` use
  different mechanisms (loose pill-map vs strict `isTabRootPath`) for the target
  of a non-bidi backward gesture; reachable via `/offline/bookmarks -> /offline`
  (target `/offline` is `tag: 'tab'` but not a strict tab root); user-visible
  morph snap at the drag-to-settle handoff. Depends on which of fact 5 vs the
  publication code is authoritative; either way the two paths disagree and the
  morph snaps. Recommended fix: add an e2e for the cited navigation pattern, then
  reconcile the publication and the settle-arm classification (options (a) or (b)
  above).

**No git mutation.** No commits, no branches, no pushes. (A stray untracked debug
file left in the working tree by a prior bun eval -
`"raw would suggest:", bothPillMapLoose ? ...` - was removed; it was not part of
the codebase and contained only a `bun -e` error message, no source.)

VOTE: BLOCK

# RV21-C01 Audit 142 (R142)

**Date:** 2026-08-06. **Votes:** A BLOCK (2), B BLOCK (2). **Counter: 0/5.**

Four defects. A: typo "roottab)" (R138 edit residual, fixed) + #tabIndexFor scoped to target
only (fixed). B: F1 comment "target via strict #tabIndexFor" wrong for publication's non-bidi
backward path (fixed to #gestureToTabIndex) + **F2 CORRECTNESS: §5 morph snap** -- the publication
uses loose `inputs.toTabIndex` for non-bidi backward `toIdx` (line 1978) but the settle-arm's
`backMorphIsNull` used strict `isTabRootPath`. They diverge for pill-mapped-but-not-tab-root
targets (`/offline/bookmarks`→`/offline`). **Fix:** gesture-release call site now uses
`#gestureToTabIndex` (the publication's actual toIdx); discrete-nav call site reconstructs the
drag's toIdx (matching #beginGesture's loose/strict logic). Gates green; 398/0. **No git mutation.**

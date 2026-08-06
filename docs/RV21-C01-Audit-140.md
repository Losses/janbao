# RV21-C01 Audit 140 (R140)

**Date:** 2026-08-06. **Round:** R140. **Votes:** auditor BLOCK.
**Counter after: 0/5.**

## Outcome

Three confirmed comment-accuracy defects in the `#republishToPager`
docstring and the Header morph-derivation comment. All three are the
same class as the R136 / R134 / R137-R139 fixes (loose-vs-strict
pill-mapping conflation; non-exhaustive case enumeration). The
publication CODE is correct in every case; only the docstring / inline
comments mis-describe the condition. Counter 0/5.

## F1 (MEDIUM, comment) -- `#republishToPager` Tab-host mode sub-case 2 omits backward-to-`/search` (orchestrator:4725-4734)

**Site:** `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:4725-4734`.

The Tab-host mode docstring claims "Three sub-cases by destination"
partitioning the publication by destination tag:

```
*    - Backward-to-deep-page (target is a deep page reached via
*      `previousEntryPathname`): the pill HOLDS at `fromTabIndex`
*      ... and publishes `backMorph: rawDragFraction`
*      so the Header morph reveals the back-arrow during the slide
*      (the destination is a deep page, matching NavPipelineHost's
*      backward behaviour).
```

The code at `:4817-4818` is:

```ts
const targetIsDeepPage = targetPath !== null && getRouteData(targetPath).tag !== 'tab';
const holdPillAtFromIdx = bidirectional && targetIsDeepPage;
```

`targetIsDeepPage = tag !== 'tab'` is TRUE for tag `'search'` as well as
tag `'detail'`. A backward swipe on a NavPipelineTabHost tab root toward
`/search` (reachable: history `[/search, /]` then back-swipe from `/`;
`#backwardTabTarget` returns `previousEntryPathname()` = `/search`) has
`targetIsDeepPage = true`, so `holdPillAtFromIdx = true` and
`backMorph = rawDragFraction`. But:

1. The heading restricts to "target is a deep page" -- `/search` is
   `tag: 'search'`, not a deep page (`tag: 'detail'`).
2. The visual claim "the Header morph reveals the back-arrow during the
   slide" is WRONG for a `/search` target: the Header's morph $derived
   takes the `targetIsSearch` short-circuit (`Header.svelte:195-199`,
   returns `currentHasTabs ? 1 : 0`) so the morph HOLDS at the source's
   at-rest (hamburger); `searchProgress` / `trackMorph` consume
   `backMorph` instead.
3. The closing claim "the destination is a deep page, matching
   NavPipelineHost's backward behaviour" is wrong for `/search`.

Sub-case 3 ("Forward-last-tab-to-`/search`") does not cover it either --
that sub-case is explicitly forward + last-tab. Backward-to-`/search` on
a bidirectional host falls through the docstring's partition entirely.

This is the same gap audit-136 B fixed in `#resolvePlan` case 1
(`:2129`, broadened to "Backward to a non-tab target (a deep page, or
`/search`)"). The sibling sweep from R136 missed the `#republishToPager`
Tab-host mode docstring.

**Reachable empirically:** verified by deriving the publication for
`/` (NavPipelineTabHost, bidirectional, `fromTabIndex = 0`) backward to
`/search` (`toData.tag = 'search'`, `targetIsDeepPage = true`,
`holdPillAtFromIdx = true`, `backMorph = rawDragFraction`). The Header's
`targetIsSearch` skip holds the morph at 1 (verified against
`Header.svelte:195-199`).

**Fix:** broaden sub-case 2 to "Backward to a non-tab target (a deep
page, or `/search` reached via `previousEntryPathname`)" and correct the
visual consumption claims for the `/search` sub-case (mirroring R136's
`#resolvePlan` fix).

## F2 (MEDIUM, comment) -- `#republishToPager` Deep-page mode sub-cases don't partition exhaustively (orchestrator:4748-4759)

**Site:** `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:4748-4759`.

The Deep-page mode docstring says the publication "splits by
pill-mapping" into two sub-cases:

```
*    - Not both endpoints pill-map to a tab ... : publishes `backMorph: rawDragFraction` ...
*    - Offline LIST mirror whose target is also a tab root
*      (`fromTabIndex >= 0 && toIdx >= 0`, e.g. `/offline` -> `/`):
*      publishes `backMorph: null` ... Both endpoints pill-map to
*      a tab via `TAB_BAR_CONFIG`, so the drag is tab-to-tab ...
```

The code at `:4829-4830` is:

```ts
const backMorphValue =
	(bidirectional && !targetIsDeepPage) || (fromIdx >= 0 && toIdx >= 0) ? null : rawDragFraction;
```

In Deep-page mode (`bidirectional = false`), raw iff
`!(fromIdx >= 0 && toIdx >= 0)` = `fromIdx < 0 || toIdx < 0`. The
`fromIdx` is the mount-time loose pill index (offline LIST mirrors get
the pill index, e.g. `0` for `/offline`); `toIdx` is the STRICT
`#tabIndexFor` (`isTabRootPath`-based, `:4803`). The two sub-cases do
not partition this raw space:

- `/offline/bookmarks` -> `/offline` (back-swipe; `leftHref` is
  `/offline` per `routes/offline/bookmarks/+page.svelte:42`):
  - `fromIdx = 0` (pill index via `TAB_BAR_CONFIG` `/offline` prefix),
  - `toIdx = #tabIndexFor('/offline') = -1` (tag `'tab'` but NOT a tab
    root; `isTabRootPath('/offline') = false`),
  - `(fromIdx >= 0 && toIdx >= 0)` = `(0 && -1)` = false -> **raw**.
  - Sub-case 1's heading "Not both endpoints pill-map to a tab" excludes
    it: BOTH endpoints pill-map loosely (`getCurrentTabIndex` of
    `/offline/bookmarks` = 0, of `/offline` = 0). "Not both pill-map" is
    FALSE under the loose reading.
  - Sub-case 2's heading "target is also a tab root" excludes it:
    `/offline` is `tag: 'tab'` but NOT a strict tab root.
  - Sub-case 2's body "Both endpoints pill-map to a tab via
    `TAB_BAR_CONFIG`, so the drag is tab-to-tab" is also misleading for
    this case -- both endpoints DO pill-map via `TAB_BAR_CONFIG` but the
    drag is NOT null (it is raw), and the "tab-to-tab" inference only
    holds under the strict `#tabIndexFor` check the code actually uses.

This is the same loose-vs-strict pill-mapping conflation R137 F1 fixed
in `#dragMorphAtSettleTakeover`, R138 fixed in three docstrings, and
R139 fixed in six sites. The Deep-page mode sub-case 1 heading still
uses loose "pill-map" language where the code uses strict `#tabIndexFor`
for `toIdx`. R134 B broadened this same sub-case to add the
offline-LIST-to-deep-page example but stopped short of the
offline-LIST-to-tag-'tab'-non-strict-target shape.

**Reachable empirically:** verified by deriving the publication for
`/offline/bookmarks` (NavPipelineHost, `fromTabIndex = 0`,
non-bidirectional) back-swipe toward `/offline` (`toIdx = -1`):
`backMorphValue = rawDragFraction`. Also confirmed
`isTabRootPath('/offline') = false` and `getCurrentTabIndex('/offline')
= 0` (the loose/strict divergence).

**Fix:** replace "Not both endpoints pill-map to a tab" with strict
language ("the target does not resolve to a strict tab root via
`#tabIndexFor`"), and correct sub-case 2's "Both endpoints pill-map to
a tab via `TAB_BAR_CONFIG`, so the drag is tab-to-tab" to use strict
language (e.g. "both endpoints resolve to a strict tab root, so
`(fromIdx >= 0 && toIdx >= 0)` holds and the drag is tab-to-tab on a
non-bidirectional host"). Alternatively broaden sub-case 1's example
list to include the offline-LIST-to-tag-'tab'-non-strict case (e.g.
`/offline/bookmarks` -> `/offline`).

## F3 (MEDIUM, comment) -- Header morph-derivation null-backMorph comment cites the wrong clause for bidirectional backward-to-tag-'tab'-non-strict-target (Header.svelte:208-217)

**Site:** `src/lib/components/organisms/Header.svelte:208-217`.

The morph-derivation comment describes the null-`backMorph` publication
rule:

```
// the only null publication is a tab-to-tab swipe on a non-centerTab
// host type (NavPipelineTabHost tab swipes and NavPipelineHost offline LIST
// routes like `/offline`, `/offline/activity` whose `leftHref`
// resolves to a tab root - the source pill-maps and the target
// is a strict tab root AND `centerTab` is undefined, so
// `#republishToPager`'s non-centerTab branch's
// `(fromIdx >= 0 && toIdx >= 0)` clause nulls `backMorph` end to
// end)
```

The publication's null condition is `(bidirectional && !targetIsDeepPage)
|| (fromIdx >= 0 && toIdx >= 0)` (`orchestrator:4829-4830`). The
`#dragMorphAtSettleTakeover` call sites compute `backMorphIsNull` from
BOTH clauses (`:3494-3496`, `:2760-2763`):

```ts
const backMorphIsNull =
	(inputs.bidirectional === true && getRouteData(back).tag === 'tab') ||
	(inputs.fromTabIndex >= 0 && isTabRootPath(back));
```

The comment's mechanism citation "(fromIdx >= 0 && toIdx >= 0) clause
nulls backMorph" describes ONLY the second clause. For a NavPipelineTabHost
backward gesture toward a `tag: 'tab'` route that is NOT a strict tab
root -- reachable via `previousEntryPathname`, e.g. history
`[/offline, /]` then back-swipe from `/` targets `/offline`
(`tag: 'tab'`, `isTabRootPath('/offline') = false`, `#tabIndexFor` =
`-1`):

- `(fromIdx >= 0 && toIdx >= 0)` = `(0 && -1)` = FALSE,
- but `(bidirectional && !targetIsDeepPage)` = `(true && true)` = TRUE
  -> `backMorph` IS null (via the FIRST clause).

The comment's claims for this case:

1. "the target is a strict tab root" -- FALSE (`/offline` is not a
   strict tab root).
2. "`(fromIdx >= 0 && toIdx >= 0)` clause nulls `backMorph` end to end"
   -- FALSE; the null comes from the first clause.

Under the established-fact definition "tab-to-tab = both endpoints
pill-map, INCLUDES offline LIST", the leading "the only null publication
is a tab-to-tab swipe on a non-centerTab host type" is correct for this
case (both endpoints pill-map). But the parenthetical's strict-tab-root
mechanism citation is wrong for it. A maintainer would conclude that
NavPipelineTabHost backward-to-`/offline` does NOT null `backMorph`
(since `/offline` is not a strict tab root and `toIdx = -1` fails the
second clause), when in fact it DOES null `backMorph` via the first
clause. The `#dragMorphAtSettleTakeover` call sites already account for
both clauses; this comment lags behind.

Note: the inline comment at `orchestrator:4824-4828` has the same
shape ("null when both source and target resolve to a tab (the target
via `#tabIndexFor`, i.e. a strict tab root on a non-bidirectional
host)") but is more clearly scoped by its "on a non-bidirectional host"
qualifier. The Header comment makes the stronger universal claim
("the target is a strict tab root") without that qualifier.

**Reachable empirically:** verified by deriving the publication for `/`
(NavPipelineTabHost, bidirectional, `fromTabIndex = 0`) backward to
`/offline` (`tag: 'tab'`, `targetIsDeepPage = false`):
`backMorphValue = null` (via `(bidirectional && !targetIsDeepPage)`),
NOT via `(fromIdx >= 0 && toIdx >= 0)`.

**Fix:** replace "the target is a strict tab root AND `centerTab` is
undefined, so ... `(fromIdx >= 0 && toIdx >= 0)` clause nulls backMorph"
with language that covers BOTH clauses, e.g. "on a bidirectional host
the target has `tag === 'tab'` (not necessarily a strict tab root); on
a non-bidirectional host the target is a strict tab root AND
`centerTab` is undefined -- either clause of `#republishToPager`'s null
condition fires". Mirror the language already used in the
`#dragMorphAtSettleTakeover` call sites.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bunx prettier --check`
clean on all referenced files; no U+2014 em-dash in any referenced
file; `bun test src/lib/stores src/lib/utils` 398/0. Publication
behaviour for all three findings verified empirically (see the
`bun -e` derivation above). No code changes; comment-accuracy only.

## Disposition

Counter after R140: 0/5. Three confirmed comment-accuracy defects in
the `#republishToPager` docstring and Header morph-derivation comment,
all the same class as the R136 / R134 / R137-R139 fixes
(non-exhaustive enumeration + loose-vs-strict pill-mapping conflation
in the publication's null/raw condition description). The publication
code is correct in every case; only the comments lag behind the
R136/R137 fixes' sibling-sweep coverage. F1 is a direct sibling-sweep
miss from R136; F2 is a direct sibling-sweep miss from R134/R139; F3 is
the same class as R139 site `Header:258` (just the earlier comment in
the same derivation, missed by R139's sweep).

**No git mutation.** No commits, no branches, no pushes.

VOTE: BLOCK

# RV21-C01 Audit 140 (R140)

**Date:** 2026-08-06. **Round:** R140. **Votes:** A BLOCK, B BLOCK. **Counter: 0/5.**

Six defects: one typo (R138 edit residual "roottab)") + five loose-vs-strict null-backMorph
comment sites. All fixed: typo corrected; loose "pill-map" replaced with strict "resolve to a
tab"; Tab-host sub-case 2 broadened to include backward-to-/search; Header null-condition
cites both clauses (bidirectional tag + non-bidirectional isTabRootPath). Gates green; 398/0.

**No git mutation.** No commits, no branches, no pushes.

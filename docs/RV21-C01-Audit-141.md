# RV21-C01 Audit 141 (R141)

**Date:** 2026-08-06. **Round:** R141. **Votes:** auditor BLOCK.
**Counter after: 0/5.**

## Outcome

Two confirmed comment-accuracy defects, both direct sibling-sweep misses
from R140's F3 fix. Same class as R140-F3 / R139 / R138 / R137-F1: the
null-`backMorph` publication rule has TWO clauses
(`(bidirectional && !targetIsDeepPage) || (fromIdx >= 0 && toIdx >= 0)`,
`orchestrator:4831`), but the two sites below cite only the second
clause as the nulling mechanism and assert "strict tab root" universally.
For a NavPipelineTabHost backward gesture toward a `tag: 'tab'` route
that is NOT a strict tab root (reachable: history `[/offline, /]` then
back-swipe from `/` targets `/offline`), the cited second clause does
NOT fire and the actual null comes from the FIRST clause. R140-F3 fixed
this exact shape in `Header.svelte:208-217`; the two sites below were
not updated as siblings. Publication CODE is correct in every case;
only the comments lag.

The R140 fixes themselves are accurate (Header.svelte:208-217 now cites
both clauses per host type; orchestrator:4723/4748/4756/4824 are
accurate under their respective mode scopes). The mobile-pager and
offline-back-swipe siblings were missed.

Counter 0/5.

## F1 (MEDIUM, comment) -- `mobile-pager.svelte.ts:27-33` null-backMorph comment cites only the second clause and asserts "strict tab root" universally

**Site:** `src/lib/stores/mobile-pager.svelte.ts:27-33`.

The docstring describes the null-`backMorph` publication:

```
*  only drag-time null publication is a tab-to-tab swipe on a non-centerTab
*  host type (NavPipelineTabHost tab swipes AND NavPipelineHost offline LIST
*  routes like `/offline`, `/offline/activity` whose `leftHref` resolves
*  to a tab root - the source pill-maps and the target is a strict tab
*  root AND `centerTab` is undefined, so `#republishToPager`'s
*  non-centerTab branch's `(fromIdx >= 0 && toIdx >= 0)` clause nulls
*  `backMorph` end to end)
```

The publication's null condition is `(bidirectional && !targetIsDeepPage)
|| (fromIdx >= 0 && toIdx >= 0)` (`orchestrator:4831`). The `#dragMorphAtSettleTakeover`
call sites compute `backMorphIsNull` from BOTH clauses
(`orchestrator:3494-3496`, `:2760-2763`):

```ts
const backMorphIsNull =
	(inputs.bidirectional === true && getRouteData(back).tag === 'tab') ||
	(inputs.fromTabIndex >= 0 && isTabRootPath(back));
```

For a NavPipelineTabHost backward gesture toward a `tag: 'tab'` route
that is NOT a strict tab root (reachable: history `[/offline, /]` then
back-swipe from `/` targets `/offline` via `previousEntryPathname`):

- `bidirectional = true`, `targetPath = '/offline'`,
  `getRouteData('/offline').tag === 'tab'` (TRUE),
  `targetIsDeepPage = false`, so
  `(bidirectional && !targetIsDeepPage)` = TRUE -> `backMorph` IS null
  via the FIRST clause.
- `isTabRootPath('/offline') = false`, so `#tabIndexFor('/offline') = -1`,
  so `(fromIdx >= 0 && toIdx >= 0)` = `(0 && -1)` = FALSE -> the cited
  SECOND clause does NOT fire.

Under the audit's established fact ("tab-to-tab = both endpoints
pill-map, INCLUDES offline LIST"), `/` -> `/offline` IS a tab-to-tab
swipe on a non-centerTab host, so the leading universal claim "the only
drag-time null publication is a tab-to-tab swipe on a non-centerTab
host type" covers it. The parenthetical's mechanism citation is wrong
for this case:

1. "the target is a strict tab root" -- FALSE (`/offline` is `tag: 'tab'`
   but NOT a strict tab root; `isTabRootPath('/offline') = false`).
2. "(fromIdx >= 0 && toIdx >= 0) clause nulls backMorph end to end" --
   FALSE; the null comes from the first clause
   `(bidirectional && !targetIsDeepPage)`.

A maintainer reading this docstring would conclude that NavPipelineTabHost
backward-to-`/offline` does NOT null `backMorph` (since `/offline` is
not a strict tab root and `toIdx = -1` fails the cited clause), when in
fact it DOES null `backMorph` via the first clause.

**Reachable empirically:** verified via `bun -e` deriving the
publication for `/` (NavPipelineTabHost, bidirectional, fromTabIndex=0)
backward to `/offline` (`tag === 'tab'`, `targetIsDeepPage = false`):
clause1 = TRUE, clause2 = FALSE, backMorphValue = null (via clause1).
Confirmed `isTabRootPath('/offline') = false` and
`getCurrentTabIndex('/offline') = 0` (loose/strict divergence).

This is the same defect class as R140-F3 (Header.svelte:208-217).
R140 fixed Header.svelte:208-217 to cite both clauses separately
("NavPipelineTabHost tab swipes, nulled via the bidirectional
`!targetIsDeepPage` clause; and NavPipelineHost offline LIST routes
like `/offline`, `/offline/activity` whose `leftHref` resolves to a
tab root, nulled via the `(fromIdx >= 0 && toIdx >= 0)` clause"). This
site was missed in the sibling sweep.

**Fix:** mirror the R140-F3 fix. Split the parenthetical by host type,
citing the first clause for NavPipelineTabHost tab swipes (target has
`tag === 'tab'`, not necessarily a strict tab root) and the second
clause for NavPipelineHost offline LIST (target is a strict tab root).
e.g. "(NavPipelineTabHost tab swipes, nulled via the bidirectional
`!targetIsDeepPage` clause - the target has `tag === 'tab'`, not
necessarily a strict tab root; and NavPipelineHost offline LIST routes
like `/offline`, `/offline/activity` whose `leftHref` resolves to a
tab root, nulled via the `(fromIdx >= 0 && toIdx >= 0)` clause)".

## F2 (MEDIUM, comment) -- `offline-back-swipe.spec.ts:14-18` universal claim cites only the second clause

**Site:** `e2e/offline-back-swipe.spec.ts:14-18`.

The test's meta-comment generalizes the publication rule:

```
// a back-swipe `/offline` -> `/` is a non-bidirectional tab-to-tab transition. The
// orchestrator's publication rule nulls `backMorph` for any tab-to-tab
// swipe on non-centerTab host types (`(fromIdx >= 0 && toIdx >= 0)` in
// `#republishToPager`), so the drag morph stays at the static at-rest
// value (hamburger mode) end to end.
```

For the SPECIFIC case the test exercises (`/offline` -> `/` on
NavPipelineHost, non-bidirectional), the cited clause IS the actual
mechanism (`(bidirectional && !targetIsDeepPage)` = `(false && true)`
= FALSE; `(fromIdx >= 0 && toIdx >= 0)` = `(0 && 0)` = TRUE -> null
via second clause). But the universal claim "for ANY tab-to-tab swipe
on non-centerTab host types" generalizes to NavPipelineTabHost
bidirectional hosts too, and the parenthetical cites the second clause
as the publication rule. For NavPipelineTabHost backward-to-`/offline`
(a tab-to-tab swipe on a non-centerTab host per the established fact):

- `(bidirectional && !targetIsDeepPage)` = TRUE -> null via FIRST clause.
- `(fromIdx >= 0 && toIdx >= 0)` = FALSE -> cited clause does NOT fire.

A maintainer generalizing from this comment would conclude that
NavPipelineTabHost backward-to-`/offline` does not null `backMorph`
(since the cited clause does not fire), when it in fact does (via the
first clause). The cited mechanism is presented as THE publication
rule, not as an illustrative example for the specific test case, so
this is not a defensible simplification.

**Reachable empirically:** verified (see F1).

This is the same defect class as R140-F3 / R139 (six sites) / R138
(three docstrings). R139 fixed six sites with this conflation;
R140-F3 fixed the Header.svelte:208-217 sibling. This test-file site
was missed in both sweeps.

**Fix:** either narrow the universal claim to the test's actual scope
("for a non-bidirectional tab-to-tab transition like this one, the
`(fromIdx >= 0 && toIdx >= 0)` clause in `#republishToPager` nulls
`backMorph`"), or cite both clauses when generalizing ("the
publication rule nulls `backMorph` for any tab-to-tab swipe on
non-centerTab host types (the `(bidirectional && !targetIsDeepPage)`
clause for NavPipelineTabHost, the `(fromIdx >= 0 && toIdx >= 0)`
clause for NavPipelineHost offline LIST)").

## Verify

```
$ bun run check
COMPLETED 1469 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
[prettier + eslint clean]
Total similar type pairs found: 63
exit=0

$ bun test src/lib
552 pass / 0 fail / 2270 expect() calls across 40 files

$ bun test src/lib/stores src/lib/utils
398 pass / 0 fail / 1349 expect() calls across 22 files
```

Publication behaviour for both findings verified empirically via `bun -e`
(deriving `backMorphValue` for `/` -> `/offline` on a NavPipelineTabHost:
clause1 = TRUE, clause2 = FALSE, backMorphValue = null via clause1;
`isTabRootPath('/offline') = false`; `getRouteData('/offline').tag ===
'tab'`). No code changes; comment-accuracy only.

## Disposition

Counter after R141: 0/5. Two confirmed comment-accuracy defects, both
direct sibling-sweep misses from R140-F3 (same class: loose-vs-strict
pill-mapping conflation in the null-`backMorph` publication rule's
description, citing only the second clause and asserting "strict tab
root" universally). The publication code is correct in every case;
only the comments lag behind R140-F3's sibling-sweep coverage. Both
are reachable (NavPipelineTabHost backward-to-`/offline` via
`previousEntryPathname`).

**No git mutation.** No commits, no branches, no pushes.

VOTE: BLOCK

# RV21-C01 Audit 141 (R141)

**Date:** 2026-08-06. **Votes:** A BLOCK (4), B BLOCK (2). **Counter: 0/5.**

Six loose-vs-strict null-backMorph comment sites (same class as R137-R140). All fixed:
mobile-pager null-clause citation + RAW enumeration broadened; orchestrator #resolveSearchProgress
dual-clause citation; orchestrator inline null-case qualifier broadened; offline-back-swipe
dual-clause citation. Gates green; 398/0. **No git mutation.**

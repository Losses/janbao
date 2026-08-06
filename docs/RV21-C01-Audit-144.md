# RV21-C01 Audit 144 (R143)

**Date:** 2026-08-06. **Round:** R143 (independent audit of the R143 fix state).
**Votes:** BLOCK. **Counter after: 0/5.**

## Outcome

The R143 fix's strict-framing cleanup is partially applied: most "tab root" / "#tabIndexFor"
residuals in null-backMorph context were caught and fixed. Three real defects remain.

## F1 (BLOCK, lint gate failure) -- `docs/RV21-C01-Audit-143.md:6` contains a U+2014 em dash

The lint gate is RED. `bun run lint` fails with:

```
docs/RV21-C01-Audit-143.md
  6:13  error  Do not use the em dash character (U+2014). Use a comma, semicolon, colon, parentheses, or reword instead  local/no-emdash
```

The R143 audit report's summary line reads:

```
Eight (A) / seven (B) strict-framing comment residuals in the null-backMorph publication-rule
description -- same class as R137-R142. ...
```

The character between "description" and "same" is U+2014. The spec's binding
comment-accuracy constraint requires `grep -P '\x{2014}' <file>` after every `.md`
or code-comment edit; that check was not run on the R143 audit file. Every other audit
in the RV21-C01 series (verified `grep -lP '\x{2014}' docs/RV21-C01-Audit-*.md docs/DV21-Meeting/*.md`)
contains zero em dashes, so this is a fresh regression introduced by the R143 report,
not a pre-existing one.

The DV21-C01-spec end state requires `bun run lint` exit 0; the gate is currently exit 1.
This blocks convergence on its own.

**Fix:** replace the em dash with a colon (or any of the rule's allowed alternatives), then
re-run `bun run lint` to confirm exit 0.

## F2 (MEDIUM, comment-accuracy, R142 F1 / R143 residual) -- `src/lib/stores/mobile-pager.svelte.ts:25-27` strict framing wrong for non-bidi backward

**Site:** `src/lib/stores/mobile-pager.svelte.ts:25-27` (the `backMorph` docstring's
drag-time NON-NULL enumeration).

The docstring reads:

```
* ... and on every NavPipelineHost drag where the target does not resolve to a strict tab
* root via `#tabIndexFor` (deep page, `/profile`, `/bookmarks`); the
```

This describes when the orchestrator publishes a NON-NULL `backMorph` (raw drag fraction)
during a drag on a NavPipelineHost (the non-bidi host). The actual publication rule in
`#republishToPager` (`orchestrator:4848-4849`) is:

```ts
const backMorphValue =
	(bidirectional && !targetIsDeepPage) || (fromIdx >= 0 && toIdx >= 0) ? null : rawDragFraction;
```

For NavPipelineHost (`bidirectional === false`), this reduces to `(fromIdx >= 0 && toIdx >= 0) ? null : raw`,
where `toIdx = #gestureToTabIndex` (`orchestrator:4821`) and `#gestureToTabIndex` for non-bidi
backward is `inputs.toTabIndex = getCurrentTabIndex(resolvedLeftHref)` (loose pill-map; set at
`orchestrator:1974-1979`). The publication's null condition is therefore a LOOSE pill-map test,
NOT a strict `#tabIndexFor` test.

**Reachable contradiction** (verified empirically via `bun -e`):

```
/offline/bookmarks -> /offline
  fromIdx (loose): 0   toIdx loose (getCurrentTabIndex): 0
  toIdx strict (#tabIndexFor): -1   (isTabRootPath('/offline') === false)
  Publication backMorph ACTUAL:        null  (because (0>=0 && 0>=0))
  mobile-pager:26 strict framing predicts: raw   (because target '/offline' is NOT a strict tab root)
```

The publication NULLS `backMorph` (target pill-maps via loose), but the docstring's strict
framing predicts `raw` (target is not a strict tab root). The comment inverts the truth for
this reachable navigation pattern. A maintainer reading this docstring would expect `/offline`
as a back-target to publish a live `backMorph`, when in fact it does not.

Same defect class as R142 F1 (the audit explicitly fixed the symmetric site at
`orchestrator:4772-4774` to "the source via loose `getCurrentTabIndex` at mount, the target
via `#gestureToTabIndex`, which is strict for bidi/forward and loose for non-bidi backward").
The mobile-pager docstring was not swept in R142 or R143.

**Fix:** rewrite "where the target does not resolve to a strict tab root via `#tabIndexFor`"
to mirror the R142 F1 framing: e.g. "where the target does not pill-map to a tab (the
publication's `toIdx` is loose `getCurrentTabIndex` for non-bidi backward, strict `#tabIndexFor`
otherwise)". The example list "deep page, `/profile`, `/bookmarks`" stays accurate (those
targets do not pill-map on either pill-map convention); the strict framing was the only
inaccuracy.

## F3 (MEDIUM, comment-accuracy, R143 internally inconsistent) -- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:4845-4847` "i.e. a strict tab root" qualifier contradicts its own `#gestureToTabIndex` citation

**Site:** `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:4842-4847` (the inline
`backMorphValue` comment in `#republishToPager`'s non-centerTab branch).

The inline comment reads:

```
// backMorph: raw slide fraction when not both endpoints resolve to a tab (deep
// host backward-exit, bidirectional backward-to-deep-page, or
// bidirectional forward-last-tab-to-`/search`). null when both
// source and target resolve to a tab (the target via `#gestureToTabIndex`,
// i.e. a strict tab root; on a bidirectional host `!targetIsDeepPage`
// also nulls tag-`'tab'` targets like `/offline`).
```

R143 changed the citation from `#tabIndexFor` to `#gestureToTabIndex` at this site but left
the qualifier "i.e. a strict tab root". These two contradict each other for the non-bidi
backward case:

- `#gestureToTabIndex` is set at `orchestrator:1974-1979`:
  - bidi backward: strict `#tabIndexFor(to)`
  - non-bidi backward: loose `inputs.toTabIndex = getCurrentTabIndex(resolvedLeftHref)`
  - forward (any bidi): strict `#tabIndexFor(to)`
- So `#gestureToTabIndex` is loose for non-bidi backward, NOT strict.
- "i.e. a strict tab root" therefore overclaims: the target via `#gestureToTabIndex` can
  pill-map (loose) without being a strict tab root.

**Reachable contradiction** (same empirical trace as F2): for `/offline/bookmarks` ->
`/offline` (Deep-page mode, non-bidi backward):

- `#gestureToTabIndex` = `inputs.toTabIndex` = `getCurrentTabIndex('/offline')` = 0 (loose)
- `/offline` is NOT a strict tab root (`isTabRootPath('/offline') === false`)
- Publication: backMorph = null (via `(0>=0 && 0>=0)`)
- Comment's "i.e. a strict tab root" is wrong: the target is NOT a strict tab root yet
  backMorph is still null.

The R142 F1 fix at the docstring three lines above (`orchestrator:4772-4774`) already states
the correct framing: "the target via `#gestureToTabIndex`, which is strict for bidi/forward
and loose for non-bidi backward". The inline comment at 4845-4847 should mirror that framing
exactly. R143 partially fixed this site (changed `#tabIndexFor` -> `#gestureToTabIndex`) but
left the "i.e. a strict tab root" qualifier that the new citation contradicts.

**Fix:** drop "i.e. a strict tab root" and replace with the directional qualifier already
used at `orchestrator:4773-4774`: "the target via `#gestureToTabIndex` (strict for bidi /
forward, loose for non-bidi backward)".

## Sampling (no defect)

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:1974-1979` (`#beginGesture`'s
  `toTabIndex` ternary): the original loose/strict derivation; verified accurate against the
  bidirectional / direction branches.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2760-2774` (discrete-nav
  `liveDragMorphToIdx` reconstruction + `liveDragMorphBackMorphIsNull`): comment "loose
  `inputs.toTabIndex` for non-bidi backward ..., strict `#tabIndexFor` otherwise" matches
  the code's `inputs.bidirectional !== true ? inputs.toTabIndex : #tabIndexFor(dragTargetPathname)`.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3503-3509` (gesture-release
  `backMorphIsNull` computation): comment "Uses `#gestureToTabIndex` (the publication's
  actual toIdx, which is loose for non-bidi backward and strict otherwise)" accurately
  describes the R142 F2 fix.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:4760-4777` (Deep-page mode docstring
  sub-cases 1 + 2): accurate, including the R142 F1 fix at 4772-4774 ("strict for bidi /
  forward and loose for non-bidi backward"). The illustrative example "`/offline` ->
  `/profile`" is a defensible non-exhaustive parenthetical.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:4503-4505` ("both endpoints resolve
  to a tab on a non-centerTab host, via the bidirectional tag clause or the
  both-endpoints-pill-map clause"): no strict framing, accurate.
- `src/lib/components/organisms/Header.svelte:206-222` (Header morph derivation's
  `backMorph` publication-rule summary): R143 fix at 212-215 ("resolves to a tab") is
  accurate; the example list "`/offline`, `/offline/activity`" is illustrative.
- `e2e/offline-back-swipe.spec.ts:12-40` (DV21 R5 F1 spec docstring): accurate, no strict
  framing.
- `e2e/reproduce-dv20-drag-sync.spec.ts:94-103` (Bug 1 docstring's `backMorph` universal
  claim): accurate, with the offline LIST null qualifier per R130-B / R131.
- `e2e/messages-back-swipe.spec.ts:2246-2249` and `:2956-2963`: tab-to-tab / shape (T,T,F)
  descriptions match the audit's established facts and the publication rule.
- `e2e/search-enter-exit-asymmetry.spec.ts:54-56`: R132 fix (non-centerTab NavPipelineHost
  route) intact and accurate.
- `src/lib/utils/header-probe.ts`: no strict framing in the publication-rule context; the
  five-reach-path `SearchAnchor` enumeration and the `EnterFabAnchor` / `DragMorphAnchor`
  docstrings match the code.
- R142 F2 correctness fix (settle-arm `backMorphIsNull` uses `#gestureToTabIndex` per
  R142; discrete-nav reconstructs loose/strict per direction): re-traced both call sites
  against `#beginGesture:1974-1979`; publication and settle-arm agree for the cited
  `/offline/bookmarks -> /offline` case (both evaluate backMorph null / backMorphIsNull
  true; no morph snap).

## Disposition

Counter after R143: 0/5. Three confirmed defects:

- F1 (BLOCK, gate failure): `docs/RV21-C01-Audit-143.md:6` U+2014 em dash fails
  `local/no-emdash`; `bun run lint` exits 1.
- F2 (MEDIUM, comment-accuracy): `src/lib/stores/mobile-pager.svelte.ts:25-27` strict
  framing inverts the publication rule for `/offline/bookmarks -> /offline` (loose pill-map
  case). Same class as R142 F1; R143 sweep missed this file.
- F3 (MEDIUM, comment-accuracy, R143 internally inconsistent): `orchestrator:4845-4847`
  keeps "i.e. a strict tab root" after R143 changed the citation to `#gestureToTabIndex`;
  the citation and the qualifier contradict for non-bidi backward. R143 partially fixed
  this site and left the contradiction.

F2 and F3 are the same defect class as the R137-R143 series has been closing; both are
reachable via the same `/offline/bookmarks -> /offline` navigation pattern that R142 F2
verified is a live code path. F1 is a fresh regression introduced by the R143 audit
report itself.

**No git mutation.** No commits, no branches, no pushes.

VOTE: BLOCK

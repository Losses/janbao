# RV21-C01 Audit 29 (R29)

**Date:** 2026-07-30. **Round:** R29. **Counter after:** 0/5 (auditor B BLOCK).
**Auditor angle:** search-axis helpers, anchor capture/clear lifecycle,
discrete-nav drag-terminal capture site (L2700-2820), `#beginGesture` two-phase
anchor capture (L1789-1820), `#searchProgressAtSettleInstant` 5-branch mirror
(L4395-4442), Header branch 3 shift (L565-609), R28 preventive guard, all
snap-magnitude claims in the layer.

## Verification baseline

- `bun run check` 0 errors / 0 warnings.
- `bun run lint` exit 0.
- `bunx playwright test e2e/messages-back-swipe.spec.ts --retries=0 --workers=1`
  41 passed (including the R28 guard: max 24.05px at t=1122ms, interruptT=1543ms;
  threshold 30px).
- `bunx playwright test e2e/reproduce-dv20-search-swipe.spec.ts
e2e/search-enter-exit-asymmetry.spec.ts e2e/search-back-hamburger-flash.spec.ts
--retries=0 --workers=1` 14 passed.
- Empirical probe (temp e2e, deleted): hdrTrackTx at `/search`
  (searchProgress = 1) measures -393px on a 393px viewport. This confirms the
  px-per-searchProgress-unit factor is **1.0** (a searchProgress delta of `d`
  produces a header-track translate delta of `d * viewport-width` px), because
  the `translateX(-(searchProgress * 50)%)` of the `w-[200%]` element evaluates
  to `-(searchProgress * 50/100) * (2 * viewport-width) = -searchProgress *
viewport-width`.

## F1 (code-comment accuracy, probe-verified): #searchProgressAtSettleInstant docstring snap-magnitude formula is off by a factor of 2

**File:** `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:4386`

The R28 docstring claims:

> "Without the drag-search-anchor branch the L2803 capture would return the
> gesture value while the Header was rendering the drag-anchor shift value,
> snapping the search track by `startProgress * 50% * viewport-width` px
> (R28 F1)."

The actual snap magnitude is `startProgress * viewport-width` px (factor of
1.0, not 0.5). The `* 50%` factor is spurious.

**Derivation.** The R28 defect is the helper (without the drag-anchor branch)
returning `1 - bm` while the Header's branch 3 returns `anchor.search +
natural(bm) - natural(anchor.raw)`. For the R28 shape (a re-grab on `/search`
taking over an enter settle seeded with `#searchAnchor = {1, 1}` by
`playEnterAnimation`'s R23-B F2 hold), `anchor.search = 1`, `isSearch = true`,
`targetIsSearch = false`, so:

```
natural(bm)         = 1 - bm
natural(anchor.raw) = 1 - anchor.raw
shift               = 1 + (1 - bm) - (1 - anchor.raw) = 1 + anchor.raw - bm
delta               = shift - (1 - bm) = anchor.raw = startProgress
```

A searchProgress delta of `startProgress` produces a header-track translate
delta of `startProgress * viewport-width` px (the empirical probe above
confirms the 1.0 factor). For the journal's measured BEFORE defect of
214.26px at viewport=393, this implies `startProgress = 214.26 / 393 = 0.545`
(consistent with the re-grab starting mid-enter-slide, roughly half complete).

**The docstring's formula evaluates to** `0.545 * 0.5 * 393 = 107.08px`,
roughly half of the measured 214.26px.

**Sibling search (binding).** I checked every other snap-magnitude claim in
the layer for the same `* 50%` (or equivalent factor-of-2) error:

- `src/lib/utils/header-probe.ts:189` "~393px snap, R23-B F2": `1.0 * 393`
  (delta = 1.0, full panel). Correct.
- `src/lib/utils/header-probe.ts:197` "~168px snap at raw=0.43, R23-B F1":
  `0.43 * 393 = 169px`. Correct.
- `src/lib/utils/header-probe.ts:212` "~240px snap on a 393px viewport,
  R24-A": `0.61 * 393 = 240px`. Correct.
- `src/lib/components/organisms/Header.svelte:544` "~96-143px snap on a 393px
  viewport, R26-A": `0.24-0.36 * 393 = 94-142px`. Correct.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2974` "the audit's
  ~168px snap" (R23-B F1). Correct.

Every sibling claim uses the correct `delta * viewport-width` factor (1.0).
Only the R28 docstring at L4386 has the spurious `* 50%` factor. This is the
single outlier; no sibling phrasings to fix.

**Failure scenario.** A reader consulting this docstring to understand the
R28 defect's magnitude (or to calibrate a regression threshold for a sibling
case) would underestimate the snap by half. The actual code (the
drag-anchor branch in `#searchProgressAtSettleInstant`, L4410-4440) mirrors
the Header's branch 3 correctly and the fix is sound (R28 preventive guard
GREEN; siblings GREEN); only the descriptive formula in the docstring is
wrong.

**Severity: concern.** Per the audit prompt's binding rule ("code-comment
accuracy is ALWAYS a concern", "There is no borderline"), an inaccurate
formula in a `.svelte.ts` docstring under-describing the snap magnitude by a
factor of 2 resets the convergence counter. The fix is to delete the
spurious `* 50%`: `startProgress * viewport-width` px (or equivalently
`startProgress * 100% * viewport-width` px).

## Additional angles examined (no defect)

- `#searchProgressAtSettleInstant` (L4395-4442): the drag-anchor branch
  mirrors Header.svelte's branch 3 shift end-to-end (same `anchorTrackMorph`
  derivation, same `naturalAtBm` / `naturalAtAnchor`, same clamp). The
  omitted bm-null hold sub-case is unreachable in the helper because
  `pub.progress` is always a non-null number when `pub.inFlight`, and for
  the only shape where `pager.backMorph` is null mid-publication
  (non-centerTab tab-to-tab) the shift collapses to `anchor.search = 0`
  via the natural-arithmetic coincidence (verified by reading
  `#republishToPager` L4761-4762 and tracing the natural-formula
  evaluation).
- `#beginGesture` two-phase capture (L1789-1820, L1956-1964, L2000-2008):
  captures `settleSearchAtTakeover` BEFORE the clears, then pairs it with
  `rawStart` AFTER `#pendingGesture.rawStart` is known. The `#dragSearchAnchor`
  clears at L1823 happen AFTER the capture, so the helper's invocation at
  L1819 sees the live `#searchAnchor` (for the settle-anchor branch) and
  `#dragSearchAnchor === null` (the docstring's "at this site #dragSearchAnchor
  is null" claim is accurate; cleared by the prior settle's `#armSettleEase`).
- L2803 capture site (L2791-2813): the inline comment accurately enumerates
  the three branch cases the helper now mirrors (settle-anchor lerp,
  drag-anchor shift, gesture / at-rest). The R28 F1 reach path (re-grab
  during enter settle interrupted mid-drag by this discrete-nav) is
  correctly named as the firing scenario for the drag-anchor branch.
- Anchor lifecycle: the canonical clears at `#armSettleEase` (L3287-3291),
  `#landAtRest` (L2361-2367), and `unmount` (L1435-1441) cover all three
  drag anchors + both lerp anchors + both prior-terminal stashes. No
  orphaned anchor state survives these sites.
- `SearchAnchor` reach path count (4) and `EnterFabAnchor` reach path count
  (5): accurate. The FAB has the gesture-release site
  (`#armSettleEaseFromGesture`); the search axis does not (the gesture
  branch's `bm` agrees with the at-rest searchProgress at release). This
  asymmetry is documented at L3280-3286.
- Header.svelte branch 3 bm-null sub-case comment (L583-591): accurate.
  The only currently-reachable shape where `pager.backMorph === null` while
  `dragSearchAnchor !== null` is the non-centerTab tab-to-tab settle
  (where `playEnterAnimation` seeds `#searchAnchor = {0, 0}`, so the hold
  returns 0 = the at-rest fallback).
- `computeFabScale` docstring (fab-scale.ts L173-178): "exercised by the
  R8-R14 e2e continuity guards" (R26-B F1 rewrite). Accurate.
- R28 preventive guard (`e2e/messages-back-swipe.spec.ts` L3592-3713):
  Phase 1 forward-swipe `/messages/inbox` to `/search`, Phase 2 re-grab
  back-swipe on `/search`, Phase 3 mid-re-grab `__e2eGoto('/activity')`.
  Assertion window starts at the re-grab's `transitionTarget` flip and
  ends at the interrupt flip + 1 frame; threshold 30px accommodates the
  natural per-rAF drag cadence (~24px, matching R26-A's 23.97px) while
  catching the ~200px boundary snap. Guard passed in this audit (max
  24.05px).
- All four snap-magnitude sibling claims (header-probe.ts L189/L197/L212,
  Header.svelte L544, orchestrator L2974) use the correct
  `delta * viewport-width` factor (1.0); only the L4386 R28 docstring has
  the spurious `* 50%`.

## Out-of-scope observations (nitpick, .md only)

- `docs/DV21-Meeting/DV21-C01-Journal.md` R28 entry (L5421-5432) has the
  same `* 50%` inaccuracy in its inline formula
  ("disagreement is `anchor.raw * 50% * viewport-width` px"). The
  qualitative range "162-219px on a 393px viewport" is correct (matches
  `0.41-0.56 * 393`); only the inline formula is off. This is a .md
  nitpick and does not block convergence.

## Counter after R29: 0/5.

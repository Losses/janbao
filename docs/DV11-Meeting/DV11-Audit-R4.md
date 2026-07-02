# DV11 - Audit Round 4

5 independent role-less auditors examined `docs/DV11-Plan.md` (v4) under a clean open-ended prompt (no audit-points section in the plan; no prior-round context in the prompt). Result: **not 5/5 PASS**. 1 PASS / 4 FAIL, all high confidence. The clean, un-steered audit surfaced a convergent blocker that the steered R1-R3 rounds under-weighted - the intended outcome of removing the §8 audit-points crutch.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | FAIL    | 1        | 2     | 2     | has-special-cases |
| 2       | FAIL    | 0        | 1     | 3     | clean             |
| 3       | PASS    | 0        | 0     | 2     | clean             |
| 4       | FAIL    | 1        | 1     | 2     | has-special-cases |
| 5       | FAIL    | 1        | 1     | 2     | has-special-cases |

Result line: **not 5/5 PASS → revised.** (Auditor 2 returned FAIL with 0 blocking - treated as a major-grade FAIL; its single major is the same deep-path leak.)

## Convergent blocker

### B1 - The `viewportHeight` derivation leaks onto the snapshot deep-preview path (BLOCKING, auditors 1, 4, 5; major auditor 2)

v4 §4.6 claims the deep-preview path is "structurally excluded / untouched." Verified false for the shared viewport derivation. `inSwipe = dragOffset !== null` (§4.2/§5), but `swipeMove:177` sets `dragOffset = follow(deltaX)` on the snapshot deep-preview back-swipe path (inside the `:173` if-branch). So during a deep back-swipe `inSwipe` is true, `destIndex = clamp(activeIndex − 1)` = the previous tab root, and `viewportHeight` flips from `panelHeights[activeIndex]` to `panelHeights[destIndex]`. The `[data-deep-preview]` overlay (`:421-438`) is `position: absolute; height: ${window.innerHeight}px` inside the `overflow-hidden` viewport (`:364-365`), so when `panelHeights[destIndex] < innerHeight` the overlay is vertically clipped - a regression on the deep-preview drag. The structural exclusion covers only the entry block / source pin (the `:183` else-branch), NOT `viewportHeight`. The existing `e2e/swipe-forward-back-deep-page.spec.ts` reads the overlay's OWN `clientHeight` (its intrinsic `innerHeight` box, `:227-232`), not the ancestor-clipped visible height, so it gives a false green and does not guard this. (Auditor 5 additionally notes the leak persists through the 300 ms `isTransitioningOut` slide-out because `:233-237` does not null `dragOffset`.)

## Convergent majors (non-blocking, addressed in revision)

- **M1 - The commit-time source vertical shift is NEW, not "symmetric with current" (auditors 4, 5; minor auditor 2).** v4 §7 framed it as symmetric with the current commit jump. Verified false: the current code keeps the source at `translateY(0)` throughout the swipe and at commit; DV11 adds `translateY(-sourceScrollY)` during the swipe that snaps to `translateY(0)` at commit - a `sourceScrollY`-px vertical shift on the exiting panel during the 200 ms snap that the current code does not produce. The framing understated the regression.
- **M2 - Direction reversal produces an unacknowledged mid-swipe viewport-height flip (auditor 1).** The live-sign `destIndex` flips between the two neighbours' indices at the `dragOffset` zero-crossing, so `viewportHeight` jumps `panelHeights[activeIndex+1]` ↔ `panelHeights[activeIndex-1]` instantaneously. Rare (reversals are usually cancelled by `reversed`) and mid-gesture, but unaddressed.
- **M3 - The §6.2 dest-no-jump sampler is near-vacuous under the reactive design (auditor 1; minors 2, 5).** With a purely reactive transform, the entry writes (`sourceScrollY`/`neighborOffset`/`dragOffset`/`sourcePinned`) flush in one Svelte batch - there is no painted stale-`neighborOffset` frame to sample. The test passes whether or not a future async regression is introduced in a way the sampler can distinguish; it is a weak regression guard, not a bug-catch.

## Minors (addressed in revision)

- **`last` is not in scope in `swipeMove`** (auditors 1, 2, 3): the `destIndex` clamp and the entry guard use `last`, which is declared only inside `follow`/`swipeEnd`. Add `const last = MOBILE_TABS.length - 1` (auditor 2 also flagged `clamp` pseudocode + a Unicode minus).
- **`sourceScrollY` capture container** (auditor 1): state explicitly it is `window.scrollY` (the pager viewport is `overflow-hidden`; sections translate within the document, not the viewport).
- **§6.2 sampler mechanics underspecified** (auditors 2, 5): the existing `holdSwipeMidDrag` dispatches touchMoves back-to-back with no inter-move `waitForAnimationFrame`; capture-the-entry-frame needs a spelled-out install/dispatch cadence.

## Convergent revision suggestion → v5 direction

1. **Gate `viewportHeight` AND the section transform on `sourcePinned` (tab-slide-only), drop `inSwipe = dragOffset !== null`.** `sourcePinned` is set ONLY by the gated tab-slide entry block (never on deep paths, which take the `:173` if-branch and never reach the `:183` else). So `viewportHeight = panelHeights[sourcePinned ? destIndex : activeIndex]` and the transform's source-pin branch key on `sourcePinned` - both stay on `activeIndex`/rest-form on deep paths. Dissolves B1 cleanly (the deep path never sets `sourcePinned`, so the viewport is untouched there).
2. **Correct the commit-source-jump framing (M1):** state honestly that DV11 introduces a `sourceScrollY`-px vertical shift on the exiting source at commit (the pin reverts with `dragOffset`), which is NEW; it is on the exiting panel during the 200 ms snap and is the tradeoff for preventing the more-noticeable entry flash-to-top the pin avoids. Net improvement; not "symmetric."
3. **Note the reversal height-flip honestly (M2):** a rare mid-gesture transient on a usually-cancelled reversal; `destIndex` is live so it lands on the correct neighbour if committed.
4. **Reframe §6.2 (M3):** the dest-no-jump sampler is a regression guard against a future async-introduction (the reactive design makes the jump impossible today); state this, and keep the source-pin and deep-path-cancel assertions as the substantive pins.
5. **Concrete edits:** add `const last = MOBILE_TABS.length - 1`; use `Math.max/Math.min`, not pseudocode `clamp`; state `sourceScrollY = Math.max(0, window.scrollY)` explicitly. No §8.

## Verified-TRUE facts carried forward (Round 4 additions)

- `inSwipe = dragOffset !== null` is TRUE on the snapshot deep-preview path (`:177` sets `dragOffset`), FALSE on the back-chip path (`:181` nulls it). Any viewport/transform signal keyed on `dragOffset !== null` leaks onto the snapshot deep path.
- The `[data-deep-preview]` overlay (`:421-438`) is `position: absolute; height: ${window.innerHeight}px`, a sibling of the sections inside the `overflow-hidden` viewport (`:364-365`) - it IS clipped by the viewport's `overflow-hidden` when `viewportHeight < innerHeight`. The pager viewport has no `position`, so it is not the overlay's containing block, but it still clips descendants' overflow.
- `e2e/swipe-forward-back-deep-page.spec.ts` reads the overlay's own `clientHeight`/`scrollHeight`/`scrollTop` and `titleTop`, not the ancestor-clipped visible extent - so it does NOT guard a viewport-clip regression.
- The current code keeps the active source at `translateY(0)` for the whole swipe and at commit (active→inactive lands on `translateY(neighborOffset)`, rAF-zeroed after `switchTo:193`/`switchBackward:213` `scrollTo(0,0)`). DV11's `translateY(-sourceScrollY)` pin is therefore NEW, not symmetric.
- `last = MOBILE_TABS.length - 1` is declared only in `follow` (`:163`) and `swipeEnd` (`:225`); `swipeMove` and any `$derived` at module scope have no `last`.
- All R1-R3 verified facts (track-dest core, `:173` structural deep-path routing, reactive transform, synchronous `neighborOffset`, `dragOffset`-lifecycle release, `panelHeights` uncorrupted, `(tabs)` snapshot restore, boundary/reversal destIndex behaviour) remain valid; v4's only structural error is the `inSwipe`-keyed viewport leak onto the deep path.

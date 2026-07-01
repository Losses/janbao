# DV11 - Audit Round 2

5 independent role-less auditors examined `docs/DV11-Plan.md` (v2, track-dest viewport) against the codebase at `6a35937`, open-ended mandate. Result: **not 5/5 PASS**. 5 of 5 FAIL, all high confidence, organic clean. The track-dest CORE derivation is unanimously endorsed as correct (it dissolves Round-1 B1/B2/B3: the e2e passes, `panelHeights` is uncorrupted, no release hook is needed). The blocking defects are entirely in the source-pin sub-mechanism and its specification.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
| ------- | ------- | -------- | ----- | ----- | ------- |
| 1       | FAIL    | 1        | 3     | 4     | clean   |
| 2       | FAIL    | 3        | 3     | 4     | clean   |
| 3       | FAIL    | 1        | 3     | 3     | clean   |
| 4       | FAIL    | 3        | 3     | 3     | clean   |
| 5       | FAIL    | 1        | 2     | 3     | clean   |

Result line: **not 5/5 PASS → revised.**

## Convergent blockers

### B1 - The source-pin entry guard is unsatisfiable; the core fix never engages (BLOCKING, 5/5)

§5 captures `sourceScrollY`/sets `swipeDirection`/`pinSource` under guard `dragOffset === null && !showDeepPreview && backChipReveal === null` placed "AFTER `getScrollChromeStore().show()` (`:188`)." Verified: `swipeMove:186` runs `dragOffset = follow(deltaX)` BEFORE `:188`. So at the cited insertion point `dragOffset` is already non-null and the guard is permanently false. Consequence: `swipeDirection` is never set → `destIndex` never resolves → `viewportHeight` stays `panelHeights[activeIndex]` (source height) → the track-dest fix does not engage - and `pinSource` never engages either. The guard also cannot be moved to function-entry to fix this: `showDeepPreview`/`backChipReveal` are set INSIDE the `:173` branch on the same first move, so at function-entry they are still their rest values and the guard cannot distinguish a tab-slide from a deep-preview/back-chip first move. The plan keeps `:186` in place yet gates on `dragOffset === null` after `:188` - an internal contradiction.

### B2 - The dest neighbour jumps one frame via the `neighborOffset` rAF lag (BLOCKING, auditors 2, 4; major for 1, 3, 5)

The dest section's transform is `translateY(neighborOffset)` (`:393/410`), and `neighborOffset = max(0, window.scrollY)` is updated by a rAF-throttled scroll listener (`:332-336`). On a forward swipe started from a scrolled source (`sourceScrollY > 0`), the plan's `window.scrollTo(0,0)` fires a scroll event, but `neighborOffset` only re-syncs to 0 on the NEXT rAF. For one frame the revealed dest sits at `translateY(sourceScrollY)` - pushed below the viewport, an empty preview. The plan's §4.5 claim that non-source sections are "off-screen during the swipe" is wrong: the dest IS the revealed, on-screen panel. This is the reported defect resurfacing for one frame; the existing e2e does not catch it (it never scrolls the source before swiping).

### B3 - `pinSource` never resets on commit (BLOCKING, auditor 2)

§4.4/§5 wire the commit-time `pinSource = false` reset to the URL-sync `$effect` (`:132-143`). Verified: that effect's body is gated by `idx !== activeIndex` (`:138`), which is FALSE after `switchTo`/`switchBackward` pre-set `activeIndex` before `navigateForward/Backward` (`:191/220`). The effect is a documented no-op for programmatic swipes (`:128-130`). The `swipeEnd` else-branch (`:244-248`) is the only other reset site and it does NOT run on commit (the forward `:227-231`/back `:232-243` branches skip it). So after a successful tab swipe `pinSource` stays `true`, the now-active section keeps `translateY(-sourceScrollY)`, and the active panel is shifted off-screen at rest - violating requirement §3.3.

## Convergent majors (non-blocking, addressed in revision)

- **M1 - Source transform specified twice, in conflicting ways (auditors 2, 4, 5; major for 1, 3).** §5 specifies BOTH a reactive template `style` branch (`translateY(${-sourceScrollY}px)` while pinned) AND an imperative `$effect`/`$effect.pre` + rAF re-apply writing the same `transform`. These race: the template re-asserts `transform` on every Svelte flush, overwriting the imperative write. The cited `GesturePageLayout.svelte:286-320` precedent writes `scrollTop` on `bind:this` elements whose `scrollTop` is NOT reactively bound - it does not transfer to a `transform` owned by a `style` binding. A single reactive branch is correct and lands in the same flush as the viewport-height change; the imperative+rAF is self-inflicted.
- **M2 - `snapInProgress` is mis-specified and redundant (auditors 2, 3, 4).** §5 lists it among `$derived`, but "true from commit until the URL-sync effect fires" is an imperative event with no reactive source - it must be `$state`, and its setter is unspecified. It is also redundant for `viewportHeight`: at commit `activeIndex === destIndex` (`switchTo:191`/`switchBackward:220` run before `dragOffset=null`), so `panelHeights[inSwipe ? destIndex : activeIndex]` is the same value whether `inSwipe` is true or false. Drop it.
- **M3 - Deep-preview exclusion via the entry guard is fragile and would regress the deep-page e2e (auditor 4).** If the guard fires before/around the `:173` branch, `destIndex = activeIndex-1` would shrink the viewport during a deep-preview back-swipe, clipping the absolute deep-preview overlay (`:421-438`) and breaking `e2e/swipe-forward-back-deep-page.spec.ts:279` (`titleTop ≈ preview.titleTop`). The exclusion must be structural (the tab-slide `else`-branch is already deep-path-free), not a flag check at function entry.

## Convergent revision suggestion → v3 direction

Multiple auditors independently proposed a drastic simplification that dissolves all three blockers by reusing the existing `dragOffset` lifecycle instead of adding a parallel source-pin state machine:

1. **Capture inside the tab-slide `else`-branch (`:183-187`), before `:186`.** The `else`-branch is reached ONLY for plain tab-slides (the deep-preview/back-chip paths took the `:173` if), so no `showDeepPreview`/`backChipReveal` guard is needed there. The first move is detected by `dragOffset === null` at the top of the `else`-branch (before `:186` sets it). This dissolves B1 and M3.
2. **Reactive source transform, no imperative effect/rAF (M1).** A single `style` branch: `translateY(inSwipe && isSource ? -sourceScrollY : (isActive ? 0 : neighborOffset))`. Svelte flushes it in the same frame as the viewport-height change.
3. **Synchronously zero `neighborOffset` in `swipeMove` at swipe start (B2).** Setting the `$state` in the event handler updates the dest section's reactive `translateY(neighborOffset)` to 0 in the same flush - no rAF lag, no dest jump.
4. **Gate everything on `dragOffset !== null` (the existing swipe-active signal), not on `pinSource`/`snapInProgress` (B3, M2).** At `swipeEnd`, `dragOffset → null` reverts the viewport derivation, the source transform, and (via the reactive branch) the dest transform, all in one flush. At commit `activeIndex === destIndex`, so the viewport is continuous and no commit reset hook is needed. Drop `pinSource` and `snapInProgress` entirely.
5. **Cancel path** (`swipeEnd` else-branch `:244-248`): restore `window.scrollTo(0, sourceScrollY)` and `neighborOffset = sourceScrollY`, clear `swipeDirection`.

## Verified-TRUE facts carried forward (Round 2 additions)

- The track-dest derivation is verified correct: swipe-time `vpHeight = panelHeights[destIndex]` equals landed `vpHeight = panelHeights[activeIndex===destIndex]` (same value, `flex: 1 0 auto` does not inflate clientHeight because the parent chain grows with content and the document scrolls - confirmed by Round-1 measured `landedMessages.vpHeight=646 === panelHeights[messages]`). The 3 e2e assertions pass UNDER the derivation in isolation.
- `panelHeights` is NOT corrupted by track-dest (transforms do not affect `offsetHeight`; the viewport-height index swap does not change section content size). v1's B3 is genuinely dissolved.
- `swipeMove:173-187` - the `:173` `if (deltaX > 0 && backSwipeShouldPopHistory(activeIndex - 1))` consumes BOTH deep paths (`:174-177` hasSnapshot → `showDeepPreview`; `:178-182` → `backChipReveal`); the `:183-187` `else` is plain tab-slide ONLY. `dragOffset = follow(deltaX)` at `:186`; `getScrollChromeStore().show()` at `:188`.
- `backSwipeShouldPopHistory` (`history-nav.ts:99-107`) returns false when the previous entry is a tab root, so the e2e's activity↔messages swipes always take the `:183-187` else-branch.
- The URL-sync `$effect` (`:131-143`) body is gated by `idx !== activeIndex` (`:138`), false after `switchTo`/`switchBackward` pre-set `activeIndex`; documented no-op for programmatic swipes (`:128-130`).
- `switchTo:191`/`switchBackward:220` set `activeIndex = destIndex` BEFORE `navStore.navigateForward/Backward` (`:200/222`) and before `dragOffset = null` (`:229/240`).
- The dest/non-active section transform is `translateY(neighborOffset)` (`:393/410`); `neighborOffset` is `$state` (`:309`) updated rAF-throttled (`:332-336`). Setting it synchronously in `swipeMove` updates the reactive transform in the same flush.
- `e2e/tab-swipe-preview-height.spec.ts` never scrolls the source before swiping (`sourceScrollY === 0` in both directions); the 3 assertions test only viewport-height equality and the back clip, not the source pin or dest transient position.
- `(tabs)/+layout.svelte:47-70` restores tab scroll via SvelteKit `snapshot`, not `pageScrollStore`; no snapshot exists on a first visit (`restoredScrollY=0`), matching a top-pinned dest preview.

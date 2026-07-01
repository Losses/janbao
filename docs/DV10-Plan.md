# DV10 - FAB Scale Drive-Model Rework

**Status:** 5/5 PASS (FINAL) + IMPLEMENTED. All 8 interaction defects (A drawer forward, B back-swipe drag, C back-arrow, D reversal, E Discussion→Activity scale-out, F Activity→Discussion scale-in, G Discussion→Messages shrink-grow, H thread back-swipe release no-disappear-replay) fixed and covered by `e2e/fab-deep-real-interaction.spec.ts`. `bun run check` 0 errors; 200 unit tests pass; 45 fab e2e pass (Family A/B/C, SSR, scroll-hide, release-snap, deep-boundary, activity-no-FAB all green).
**Scope:** Mobile only (`max-width: 767px`). Desktop unchanged.
**HEAD at authoring:** `43317e6`.
**Predecessor:** DV09 delivered the FAB. DV09's `scaleFromFraction = 2f − 1` 0.5 threshold and its rAG sampler over the computed track transform are the load-bearing causes of the four reported defects. DV10 supersedes the DV09 scale-drive model; DV09's placement (AppShell), route-config `deep` kind, scroll-hide `translateY`, and atom styling are unchanged.
**Audit:** Round 1 - `docs/DV10-Meeting/DV10-Audit-R1.md` (3/5 returned, 2 FAIL + 1 PASS, two blockers). Round 2 - `docs/DV10-Meeting/DV10-Audit-R2.md` (1/5 PASS, 4/5 FAIL, one convergent blocker + six majors). Round 3 - `docs/DV10-Meeting/DV10-Audit-R3.md` (5/5 PASS; R2 blocker + majors verified fixed; one convergent major folded into v3.1).

**Round-1 revision (v2) summary.** Two blockers forced changes. (1) Overloading `backMorph` as the FAB signal regresses Header's thread-route morph. v2 introduces a FAB-only `coverProgress` field on the pager store, published by GPL on both the centerTab and deep branches; Header does not read it. (2) Splitting the atom's `transform` breaks the SSR assertion block and trajectory samplers. v2 keeps the combined `transform`.

**Round-2 revision (v3) summary.** R2 found a new convergent blocker: the centerTab branch's `dragProgress` (`GesturePageLayout.svelte:343`, `-dragOffset/W`) is sign-broken for rightward back-swipes, so `coverProgress` stayed 0 on thread routes. v3 computes `coverProgress` on the centerTab branch with the SAME direction-aware `rawDragOffset` normalization the deep branch uses (`:374-377`). v3 also: makes `coverProgress` OPTIONAL on `PagerUpdate`; gates the sampler arm-effect to `family === 'list'`; collapses `sampleFraction`/`fractionFromSample`/`isRestingTarget` to list-only; tightens the transition gate to `(!pager.dragging && !samplerActive) || (discreteNavInFlight && !samplerActive)`; adds the `discreteNavInFlight` stale-latch clear effect; adds `fab-release-snap.spec.ts` to the rewrite list.

**Round-3 amendment (v3.1).** 5/5 PASS. Non-blocking convergent items folded in so the blueprint is complete: (a) the store `set()` body assigns `coverProgress = update.coverProgress ?? null` (mirroring `targetIndex`), and `PagerStore` gains the `$state` + getter; (b) `fab-scale.test.ts` deletes the `pxToFraction`, `listForegroundFromThreadCover`, AND `familyRestsAtSampleOne` describe blocks + imports (not just the last); (c) the thread-route e2e also samples post-commit and asserts scale stays ≥0.3 (no mid-commit flash); (d) `restingFraction` resolves `activeTab = pager.active ? pager.fractionalIndex : getCurrentTabIndex(page.url.pathname)` for SSR; (e) the clear effect reads `navStore.navInFlight` + `page.url.pathname` (`afterNavigate` is the root-layout hook name, not a reactive source); (f) deep→deep pop is honestly stated as an UN-eased single frame (same family, latch does not arm); (g) chip-exit precedence re-stated; (h) the `:411` disarm-guard is retained defensive dead code or deleted.

## 1. Goal

The FAB scale must be a pure function of the live gesture/page position, on every interaction path: forward drawer tap, back-swipe drag (realistic speed), back-arrow tap, direction reversal, and tab swipe. No jump, no late drop, no mid-gesture disappearance, no stale-latch freeze.

The four defects DV10 must eliminate (reproduced in `e2e/fab-deep-real-interaction.spec.ts`, all FAIL on `43317e6`):

- **A** drawer `/`→`/bookmarks`: scale holds 1 ~430 ms then drops in ~2 frames.
- **B** realistic back-swipe `/bookmarks`→`/`: scale stays 0 through the drag, moves only at the commit snap.
- **C** back-arrow `/bookmarks`→`/`: 0 intermediate frames, pure 0→1 jump.
- **D** direction reversal in one gesture: FAB does not re-track (masked by B in headless).

## 2. Confirmed root cause (architecture review, verified)

### 2.1 The `maxDrag = 0.3` hypothesis is rejected

5/5 architecture-review agents refuted the claim that `maxDrag = innerWidth * 0.3` (`GesturePageLayout.svelte:174`) clamps the `/bookmarks`↔`/` drag. That drag takes the panel-slide branch: `/` is cached, `leftNeedsLoading = false`, `swipeNeedsLoadingAtStart = false` (`:482`), `onSwipeMove` assigns `dragOffset = clampedX` directly (`:510`) with no `maxDrag` clamp. `maxDrag` bounds only the chip-loading path.

### 2.2 The real cause of B is the 0.5 threshold plus the 0.2 deadzone

`scaleFromFraction(f) = clamp(2f − 1, 0, 1)` (`fab-scale.ts:37-39`) outputs 0 for `f ≤ 0.5`. `visualDragOffset` (`GesturePageLayout.svelte:410-418`) is 0 until `dragOffset > W * HEADER_MORPH_THRESHOLD`, `HEADER_MORPH_THRESHOLD = 0.2` (`gesture-constants.ts:3`). ForegroundFraction stays ≤ 0.5 until the finger has moved ~70% of the viewport, so scale is 0 through the drag.

### 2.3 Thread routes share the defect

`/discussion/*` passes `centerTab={0}`, routes into the GPL `centerTab !== undefined` branch, but the FAB overlay sampler reads the same track m41 and applies the same `scaleFromFraction`. `fab.spec.ts` Family B back passes only because `e2e/helpers.ts:swipeHorizontal` dispatches all touchMoves synchronously with `timestamp: 0`, compressing the drag into one frame. DV10 fixes thread and deep together.

### 2.4 The sampler/holdover state machine causes A, C, D

`foregroundFraction` reads `sampledFractionalIndex` from a rAG poll of `getComputedStyle(track).transform`. The poll is one frame behind the reactive store, behind a state machine of latches (`samplerHasPublished`, `forwardNavHoldoverActive:461`, sampler-gap-holdover `:506-514`). Any latch miss pins scale at its rest value - the mechanism behind A, C, and D.

## 3. Owner-locked requirements

1. **Pure-function scale on overlay/deep.** FAB scale for the overlay family is a pure function of a live signal read from the reactive pager store, with no rAG sampler and no holdover latch.
2. **Gesture-following on the drag.** Scale tracks the finger across the full drag range.
3. **Click navigation animates.** A tap (drawer link, back arrow, tab bar) animates the scale over ~200 ms on every family swap.
4. **Covers all families.** Thread, deep, compose, and tab routes animate correctly in both directions.
5. **No Header regression.** Header's `backMorph` consumption is unchanged.
6. **No regression.** Family A tab-swipe trajectory tests, Family C compose transition tests, scroll-hide, SSR deep-link scale(0), and the existing shape assertions remain valid (thresholds adjusted where the new full-range curve changes the shape).

## 4. Target architecture

Two scale drivers, selected by family, both pure functions of live state:

- **Family B (overlay: thread + deep):** `foregroundFraction = pager.coverProgress ?? restingFraction`. `coverProgress` is a FAB-only field published by GPL on both the centerTab and deep branches, computed deadzone-free from `rawDragOffset/viewportWidth` (the same value the deep branch already computes for `backMorph`). Read directly via `$derived` every frame. No sampler, no holdover for this family.
- **Family A (list / tab):** keep the existing sampler reading the MobileTabPager track m41. The MobileTabPager `fractionalIndex` jumps to its integer endpoint on release while the track keeps easing (`MobileTabPager.svelte:87`), so the per-frame track read is the correct continuous signal for the tab family. The sampler is retained ONLY for Family A.
- **Family C (compose):** unchanged. Discrete foregroundFraction swap eased by the atom CSS transition.

`scaleFromFraction` loses the `2f − 1` 0.5 threshold; scale maps the full `[0,1]` foreground range (identity, or a soft easing). DV09's "first 50% disappear / last 50% appear" lock is superseded: the FAB follows the gesture throughout. Endpoint values (0 at covered rest, 1 at list rest) are unchanged, so SSR assertions hold.

Non-drag navigation (click tap, forward-enter, commit snap after release) is eased by the atom's CSS transition, enabled for every family swap. The `familyCInFlight` latch (`FloatingActionButtonLayer.svelte:204-228`) generalizes to `discreteNavInFlight`, armed on any non-null distinct `(previousFamily, currentFamily)` pair, holding the transition class across the route swap.

The `forwardNavHoldoverActive` latch (`:461-467`) and the sampler-gap-holdover branch (`:506-514`) are removed. The CSS transition replaces the holdover for forward-enter and click-nav; the live `coverProgress` read replaces it for the drag.

### 4.1 A FAB-only `coverProgress` field (v3 - direction-aware on centerTab, optional field)

The pager store (`src/lib/stores/mobile-pager.svelte.ts`) gains an OPTIONAL `coverProgress?: number | null` field on `PagerUpdate`, store-default `null`. Only `GesturePageLayout` writes it; `MobileTabPager`, `SearchScopePager`, and the GPL reset (`:889`) are untouched (they leave it `null`, which the FAB reads via `?? restingFraction`).

`GesturePageLayout.svelte` publishes `coverProgress` on BOTH branches from a direction-aware, deadzone-free drag progress. CRITICAL (v3 - fixes the R2 blocker): the centerTab branch must NOT reuse its existing `dragProgress` variable (`:343`, `Math.max(0, Math.min(1, -dragOffset/viewportWidth))`), which is sign-broken for `swipeDirection === 'right'` (back-swipe) where `dragOffset > 0` clamps it to 0. Both branches use the deep branch's normalization (`:374-377`):

- `val = swipeDirection === 'right' ? rawDragOffset : -rawDragOffset`
- `progress = clamp(val / viewportWidth, 0, 1)`

centerTab branch (`:336-358`): publish `coverProgress = progress` during drag, `0` at rest. (No `1` on commit - the centerTab route unmounts on commit when the URL leaves the thread route; "1 on commit" applies only to the deep branch.) `backMorph` stays `null` on this branch.
deep branch (`:359-407`): publish `coverProgress = progress` during drag, `1` on commit (`:396`), `0` at rest (`:405`), alongside the existing `backMorph` writes.

`rawDragOffset` (`GesturePageLayout.svelte:78`) is the unclamped, un-deadzoned finger offset, so `coverProgress` is deadzone-free. This is intentional chrome/content phasing: `coverProgress` (like `backMorph`) responds from finger displacement 0, while the visible track (`visualDragOffset`) has the 0.2 `HEADER_MORPH` deadzone. The FAB and Header both respond in the deadzone; the content slides after. This mirrors how Header already morphs and is consistent across the chrome layer. It is NOT the bug-B symptom (bug B was scale stuck at 0 through the whole drag; here scale tracks the finger from displacement 0).

Header does not read `coverProgress` (grep confirms zero consumers outside the FAB). `MobileTabBar.svelte:55-63` reads `backMorph` but is gated on `targetIndex !== null` (centerTab publishes `null`), so it is unaffected. `/search` runs the deep branch and publishes `coverProgress`; its inner `SearchScopePager` is a separate store that does not leak.

deep→deep swaps (e.g. `/bookmarks`→`/profile/*`): both endpoints rest at scale 0, but the deep branch publishes `coverProgress → 1` at commit, so the FAB shows ONE frame at scale 1. Because it is overlay→overlay (same family), `discreteNavInFlight` does NOT arm, so this 1→0 is UN-eased (instantaneous), not a 200 ms transition. v3.1 states this honestly: it is a single-frame pop between two invisible states, not an eased animation. §7's deep→deep e2e asserts no PERSISTENT scale-1 flash (a single frame is accepted; sustained scale 1 is a failure). A future cleanup could gate `coverProgress → 0` on `isDeepToDeep` to match Header (`Header.svelte:69,143`), out of DV10 scope.

### 4.2 Forward-enter, commit, and rest on deep routes

The deep branch publishes `coverProgress = 0` at rest (`dragOffset === null`, not committed). Forward-enter on a deep route therefore sees `coverProgress = 0` immediately at mount, which would make scale jump to 0. The atom CSS transition (§4.3) eases the 1→0 over 200 ms across the route swap, so no jump. `forwardNavHoldoverActive` is not needed.

### 4.3 Atom CSS transition, enabled for all family swaps (v3 - no transform split, no double-clock)

The atom KEEPS the combined binding `style:transform={`scale(${scale}) translateY(${translateY}px)`}` and the `.fab-transition { transition: transform 200ms ease-out }` class (`FloatingActionButton.svelte:70,94`). The change is only to WHEN the class is on:

- `transitionEnabled` drops the `family === 'compose' || familyCInFlight` restriction. New gate (v3 tightens the R2 double-clock finding): `(!pager.dragging && !samplerActive) || (discreteNavInFlight && !samplerActive)`. The `discreteNavInFlight` latch NEVER overrides the sampler - it only eases swaps the sampler is not driving (compose, and overlay click-nav where the sampler is now family-gated off, §4.5). During a Family A snap after a tab-swipe commit, the sampler drives and the latch cannot turn the transition on.
- `discreteNavInFlight` (the generalized latch) arms on any non-null distinct `(previousFamily, currentFamily)` pair and holds the class across the route swap. It clears on: the 280 ms timer; the next distinct family swap; AND (v3.1 - new `$effect`) reading `navStore.navInFlight` going false AND `page.url.pathname` settling (the root layout's `afterNavigate` → `handleAfterNavigate` is what clears `navInFlight`; `afterNavigate` itself is a lifecycle hook, not a reactive source the effect can read directly). This prevents a stale latch after a lost navigation.

`startSampler` sets `samplerActive = true` synchronously at entry (`FloatingActionButtonLayer.svelte:301-302`), so the arm-effect flush already has `samplerActive = true` before the first render. No first-frame window where transition and sampler both drive.

Cost accepted: a route-swap CSS transition eases `translateY` too, so scroll-hide is briefly eased during a route swap. The FAB is scaling during a route swap regardless, and `scroll-chrome` (the source of `translateY`) is stable across a route swap, so the visual cost is minor. A future cleanup can split the properties once the test suite is migrated.

### 4.4 `scaleFromFraction` full-range curve

`fab-scale.ts:37-39` becomes an identity over `[0,1]` (or a soft easing). The half/half symmetry is removed; endpoint behavior is preserved.

### 4.5 Family A keeps its sampler; overlay drops it (v3 - arm-effect gated, helper call-sites tracked)

- `familyNeedsSamplerDuringDrag` (`fab-scale.ts:106-108`) returns `true` ONLY for `'list'`. The `'overlay'` branch is removed.
- The sampler ARM-effect (`FloatingActionButtonLayer.svelte:390-416`) is gated `family === 'list'` (Family A only). Overlay never arms the sampler - not during a drag, and not on non-drag/click-nav/idle either. (R2 M2: the v2 claim "never arms for overlay" was false because only the `:411` DISARM guard checked family, during drag. v3 moves the family gate into the arm condition itself.) `startSampler()` is reached only when `hasTrack && hasCfg && family === 'list' && !chipExitActive`.
- `familyRestsAtSampleOne` (`fab-scale.ts:122-124`) is removed; its caller `isRestingTarget` (`FloatingActionButtonLayer.svelte:344-351`) collapses to the `Math.abs(sample - Math.round(sample))` branch (only `'list'` remains, where the helper was always false).
- `pxToFraction` (`fab-scale.ts:55-58`) and `listForegroundFromThreadCover` (`:69-71`) are removed; their callers `sampleFraction()` (`FloatingActionButtonLayer.svelte:269-285`, overlay branch at `:281`) and `fractionFromSample()` (`:292-297`, overlay branch at `:294`) collapse to their `'list'` body (overlay branches deleted). With overlay reading `coverProgress` directly, these functions serve only Family A.
- `sampledFractionalIndex` is retained: it is read by the Family A sampler path AND by the Activity `'dynamic'` fabConfig branch (`:158-164`) as the mid-slide witness that keeps the source-list FAB mounted until the track finishes sliding.
- A future cleanup (out of scope) can make MobileTabPager publish a continuous snap-progress so Family A also drops the sampler.

`restingFraction` (referenced in §4, defined here): overlay/compose family → `0` (the source-list FAB is covered at rest); list family → `tabFraction(activeTab, tabIndex)` where `activeTab = pager.active ? pager.fractionalIndex : getCurrentTabIndex(page.url.pathname)` (the `pager.active` fallback to the URL tab makes a deep-link SSR render scale(1) on a list route before the pager mounts). 1 when its own tab is foreground, 0 when another tab is.

**chip-exit precedence (v3.1 re-statement):** the `foregroundFraction` derivation tests `chipExitActive` FIRST (force 0, the FAB hides under the cross-tab LoadingChip z-30 overlay) BEFORE reading `coverProgress`/restingFraction. The `chipExitActive` gate (`FloatingActionButtonLayer.svelte:443-458`) is unchanged.

The `:411` disarm-guard (`if (pager.dragging && !familyNeedsSamplerDuringDrag(family))`) becomes unreachable defensive dead code once the arm-effect is gated `family === 'list'` (only list arms, and list always returns true from `familyNeedsSamplerDuringDrag`). Retain it as defensive for a future family, or delete it; either is safe.

## 5. Concrete edits

- `src/lib/stores/mobile-pager.svelte.ts` - add OPTIONAL `coverProgress?: number | null` to `PagerUpdate` and the store shape, store-default `null`. CRITICAL (v3.1): the `set()` body (`:51-57`) must assign `coverProgress = update.coverProgress ?? null` (mirroring the existing `targetIndex` fallback at `:56`), or GPL's writes never reach the `$state` and the GPL reset never clears a stale value. `PagerStore` gains the `coverProgress` `$state` declaration + getter mirroring `backMorph`. (Optional so the 6 other `pager.set` call sites - MobileTabPager ×3, SearchScopePager ×3, GPL reset - compile untouched.)
- `src/lib/components/templates/GesturePageLayout.svelte` - centerTab branch (`:336-358`) computes `coverProgress` from the direction-aware `rawDragOffset` normalization (`val = swipeDirection === 'right' ? rawDragOffset : -rawDragOffset; clamp(val/W, 0, 1)`), publishing it during drag and `0` at rest; deep branch (`:359-407`) publishes `coverProgress = progress/1/0` alongside `backMorph`. `backMorph` unchanged on both branches.
- `src/lib/utils/fab-scale.ts` - `scaleFromFraction` full-range (identity over `[0,1]`); `familyNeedsSamplerDuringDrag` list-only; remove `familyRestsAtSampleOne`, `pxToFraction`, `listForegroundFromThreadCover`.
- `src/lib/components/templates/FloatingActionButtonLayer.svelte` - overlay/deep `foregroundFraction` reads `pager.coverProgress ?? restingFraction` via `$derived` (Family A keeps the sampler path); the sampler arm-effect (`:390-416`) gated `family === 'list'`; `sampleFraction`/`fractionFromSample` collapse to list-only (overlay branches deleted); `isRestingTarget` (`:344-351`) collapses (no `familyRestsAtSampleOne`); remove `forwardNavHoldoverActive` and sampler-gap-holdover; rename/generalize `familyCInFlight` to `discreteNavInFlight` covering any distinct family swap, with a NEW clear effect reading `navStore.navInFlight`/`afterNavigate` that clears the latch and its timer; `transitionEnabled` gated by `(!pager.dragging && !samplerActive) || (discreteNavInFlight && !samplerActive)`.
- `src/lib/components/atoms/FloatingActionButton.svelte` - no change (combined `transform` binding kept).
- `e2e/fab-deep-real-interaction.spec.ts` - flip A/B/C/D to assert correct trajectories (D strengthened: detect the reversal trough, then assert a monotonic rise ≥ 0.7 on the second rightward leg). Samplers keep reading `getComputedStyle(fab).transform` matrix (atom unchanged). Uses the local `realisticSwipeBack` (30 ms/step), NOT `helpers.swipeBack`.
- `e2e/fab.spec.ts` - Family B back swipe rewritten to realistic speed (copy `realisticSwipeBack`); Family A trajectory thresholds adjusted for the full-range curve (tab-mid scale now ~0.5; the existing 0.5-crossing and (0.3,0.7)-intermediate assertions still hold, minScale<0.5 becomes minScale<0.5 at a different drag fraction - re-derive).
- `e2e/fab-release-snap.spec.ts` - re-derive the commit distance and the `(lo, hi)` band / `gapHi` bounds under the identity curve; the cancel test's `minScale<0.9` rationale re-derived (50 px cancel now starts at ~0.87, not ~0.93).
- `e2e/fab-deep-page-boundary.spec.ts` - synthetic `__e2eGoto` + synchronous `swipeBack` paths retired or rewritten to realistic gestures (§6); SSR block unchanged (atom combined `transform` kept).
- `src/lib/utils/fab-scale.test.ts` - rewrite `scaleFromFraction` assertions to the identity curve; DELETE the `pxToFraction`, `listForegroundFromThreadCover`, AND `familyRestsAtSampleOne` describe blocks AND their imports (v3.1: v3 named only the last - all three functions are removed in §4.5, so all three test blocks + the `familyNeedsSamplerDuringDrag` overlay assertion must go, or the file will not compile).

## 6. Process defect to address

`e2e/fab-deep-page-boundary.spec.ts` passed 10/10 on `43317e6` while real interactions were broken, because `openSidebarAndGoto` (via `__e2eGoto`) and the synchronous `swipeBack` compress every transition into the commit snap. DV10 retires those synthetic paths in favor of realistic-speed gestures, or deletes the spec. `fab.spec.ts` Family B back has the same compression bug and is rewritten.

## 7. Tests

- `e2e/fab-deep-real-interaction.spec.ts` A/B/C/D flip to assert: A smooth multi-frame scale-out (≥5 intermediate samples), B scale leaves 0 during the drag (≥0.3 at t≤750 ms), C click-nav animates (≥3 intermediate), D monotonic rise ≥0.7 on the second rightward leg after the reversal trough. All use the local `realisticSwipeBack` (30 ms/step), not the synchronous `helpers.swipeBack`.
- Add a thread-route back-swipe trajectory test (`/discussion/*`→`/`), realistic speed, since thread shares the defect (this is the regression guard for the R2 B3 centerTab sign fix). v3.1: also sample POST-commit and assert scale stays ≥0.3 across the commit boundary (the centerTab branch publishes `coverProgress = 0` at rest; the swap to the list route's scale 1 is eased by `discreteNavInFlight` - assert no mid-commit flash to 0). `/messages/<id>` shares the centerTab branch (centerTab={2}); one test suffices, note the parity.
- Add a deep→deep swap test (`/bookmarks`→`/profile/edit` via drawer) asserting no persistent scale-1 flash (both endpoints rest at 0; a brief symmetric pop is accepted, a sustained flash is a failure).
- `e2e/fab.spec.ts` Family A/B/C trajectory thresholds adjusted for the full-range curve; Family B back swipe rewritten to realistic speed.
- `e2e/fab-release-snap.spec.ts` commit-distance and band bounds re-derived under the identity curve.
- `src/lib/utils/fab-scale.test.ts` rewritten for the full-range `scaleFromFraction`; `familyRestsAtSampleOne` block and `familyNeedsSamplerDuringDrag` overlay assertion deleted.
- SSR assertions (`fab.spec.ts` SSR block, `fab-deep-page-boundary.spec.ts` SSR block) verify `scale(0)` on deep/overlay/compose and `scale(1)` on list, parsed from the unchanged `style="transform: scale(...) translateY(...)"`.

## 8. Risks

- **GPL publishes `coverProgress` on the centerTab branch.** Lower risk than v1's `backMorph` overload: `coverProgress` is a new field with no existing consumer but the FAB. Must still verify no other component reads it (grep on introduction).
- **`discreteNavInFlight` latch correctness.** A stale latch after a lost navigation masks the next gesture with a transition. The latch clears on the 280 ms timer, on the next distinct family swap, AND on `navStore.navInFlight` going false / `afterNavigate`.
- **Combined `transform` transition eases `translateY`.** Accepted minor cost (§4.3).
- **Family A sampler retained while Family B drops it.** Two scale paths coexist; `foregroundFraction` must branch cleanly on family so the removed holdover/gap-holdover leave no dead references.

## 9. Audit points for Round 3

- Does the centerTab branch's direction-aware `coverProgress` (from `rawDragOffset` with the `swipeDirection === 'right' ? raw : -raw` sign) publish 0→1 across a thread back-swipe drag, fixing bug B on thread routes (`/discussion/*`, `/messages/<id>`)? This is the R2 B3 regression guard.
- Is `coverProgress` optional on `PagerUpdate`, and do the 6 non-GesturePageLayout `pager.set` call sites compile without edits?
- Is the sampler arm-effect gated `family === 'list'`, so overlay never arms a sampler (drag, click-nav, or idle)? No wasted rAF on overlay.
- Are `sampleFraction`/`fractionFromSample`/`isRestingTarget` collapsed to list-only with no dangling references to the removed helpers (`pxToFraction`, `listForegroundFromThreadCover`, `familyRestsAtSampleOne`)?
- Is the `transitionEnabled` gate `(!pager.dragging && !samplerActive) || (discreteNavInFlight && !samplerActive)` free of double-clock on the overlay→list back-swipe commit (Family A sampler drives the snap; the latch cannot override it)?
- Does the new `discreteNavInFlight` clear effect (reading `navStore.navInFlight`/`afterNavigate`) prevent a stale latch after a lost navigation?
- Is `fab-release-snap.spec.ts` threshold re-derivation correct under the identity curve?
- Is the deadzone-free `coverProgress` (FAB responds from finger displacement 0, ahead of the visible track's 0.2 deadzone) an intentional, consistent chrome/content phasing (matching Header), not a recurrence of bug B?

# DV16-C00 - Implementation Journal

Development log for the DV16 compose-family FAB back-swipe fix. Spec: `docs/DV16-Plan.md` (5/5 PASS, FINAL, after 3 audit rounds). After implementation, a 5-agent role-less open-ended audit runs; each round's verdicts are recorded in `RV16-C00-Audit-NN.md`. Work is "done" only when a round returns 5/5 unconditional accept.

## Phase map

1. **FAB layer**: `FloatingActionButtonLayer.svelte` `foregroundFraction` collapse (overlay + compose read `coverProgress`) + header-block refresh + `1:1` comment fix. `chipExitActive` unchanged (list-only).
2. **GPL source**: `GesturePageLayout.svelte` pager `$effect` gates the published `coverProgress` on `swipeNeedsLoadingAtStart` (publish 0 during a chip-exit) at the centerTab publish point and the two deep publish points.
3. **Docstrings**: `FloatingActionButton.svelte`, `fab-scale.ts` (file header + `familyNeedsSamplerDuringDrag`), `mobile-pager.svelte.ts` (`coverProgress` field), `fab-scale.test.ts` (Family C label).
4. **E2E**: `e2e/fab-compose-backswipe.spec.ts` - drop `test.fail` → `test`, add `preSwapIntermediateCount > 0`, add the chip-exit test.
5. **Verify**: `bun run check`, `bun run lint`, `bun test src/`, `bunx playwright test`.
6. **Audit loop**: 5-agent open-ended audit → `RV16-C00-Audit-NN.md` per round → loop until 5/5.

## Log

### Implementation

**FAB layer - `src/lib/components/templates/FloatingActionButtonLayer.svelte`**

- `foregroundFraction` (`:372`): the `overlay` and `compose` branches collapse into one unconditional `return pager.coverProgress ?? 0` after the `list` early-return. The derivation is now two-signal (list reads the Family A sampler; overlay + compose read `coverProgress`), with an exhaustive final return (no dead trailing branch). The inline comment states the invariant and the chip-exit behavior.
- File header block: the Family C line now states that compose reads `coverProgress` like overlay (the discrete CSS transition handles only the non-drag swap). The `scaleFromFraction` line is corrected from "1:1 over [0,1]" to "the second half of its range (`clamp(2·f − 1, 0, 1)`)".
- `chipExitActive` (`:354-367`): unchanged. It stays list-only and handles the MobileTabPager chip; the GPL `coverProgress` gating now handles the GPL chip for overlay/compose directly, so no consumer-side extension is needed.

**GPL source - `src/lib/components/templates/GesturePageLayout.svelte`**

- The pager `$effect` (`:339-435`) gates the published `coverProgress` on `swipeNeedsLoadingAtStart`:
  - centerTab branch single publish point (`:386`): `coverProgress: swipeNeedsLoadingAtStart ? 0 : cover`.
  - deep branch drag publish (`:423`): `coverProgress: swipeNeedsLoadingAtStart ? 0 : progress`.
  - deep branch committed publish (`:432`): `coverProgress: swipeNeedsLoadingAtStart ? 0 : 1`.
  - The at-rest sub-branches already publish `0` (centerTab via the `let cover = 0` initializer; deep at `:441`); no change.
- Only `coverProgress` is gated. `fractionalIndex`, `dragging`, `active`, `backMorph`, `targetIndex` keep their existing values in all four `pager.set` calls, so the MobileTabBar pill and the Header morph are unaffected.
- Two comments (centerTab cover comment, deep-branch comment) document the chip-exit gating.

**Docstrings (no functional change)**

- `src/lib/components/atoms/FloatingActionButton.svelte`: the CSS-transition docstring now states Family A runs the sampler and Families B/C read `coverProgress`, and carries the correct `transitionEnabled` formula (`!pager.dragging && (discreteNavInFlight || pendingNav !== null)`).
- `src/lib/utils/fab-scale.ts`: the file header's "1:1 over the full range" is corrected to "the second half of its range"; the `familyNeedsSamplerDuringDrag` docstring states Families B and C both read `coverProgress` (the CSS transition eases only their discrete swaps).
- `src/lib/stores/mobile-pager.svelte.ts`: the `coverProgress` field docstring is reworded to describe the source-list reveal-progress semantic (consumed by the FAB layer, published by GesturePageLayout).
- `src/lib/utils/fab-scale.test.ts`: the Family C label reads "reads live coverProgress, like overlay".

**E2E - `e2e/fab-compose-backswipe.spec.ts`**

- The two back-swipe DEFECT tests drop `test.fail` → `test` and assert BOTH `maxPreSwapScale > 0.3` AND `preSwapIntermediateCount > 0` (a ramp, not a pop). CALIBRATION gains `preSwapIntermediateCount > 0` for symmetry.
- Two chip-exit tests: from `/post/discussion` (centerTab branch) and from `/bookmarks` (deep branch), a cross-tab tap to `/activity` triggers the GPL chip-exit; a probe keys the window on the `.loading-overlay` DOM (not on `pendingNav`) and asserts the FAB scale stays `< 0.1` for every frame the overlay is mounted (and that the overlay mounted for ≥ 1 frame, so the chip-exit is exercised). The overlay variant covers the deep-branch gating the compose variant does not reach.
- The doc comment states the two guarded invariants (compose reads `coverProgress`; GPL gates `coverProgress` to 0 during a chip-exit).

### Carried-to-implementation notes (resolved, per `DV16-Audit-R3.md` (a)-(i))

- (a) §6.13 of the plan was rewritten: the GPL onMount cleanup at `:926` nullifies `coverProgress` via the store's `?? null` default; no stale window.
- (b) Docstring refresh widened to `fab-scale.ts:8-11` (file header), `mobile-pager.svelte.ts:35-38`, and the `fab-scale.test.ts` label.
- (c) centerTab gating lands at the single publish point (`:381`); deep branch at `:418`/`:427`.
- (d) §6.3 discrete-back timing is an intentional improvement, not "Preserved": the discrete back now reads `coverProgress = 1` during the committed slide, so the CSS ease runs during the slide (~200ms) rather than after the swap (~400ms total), matching the overlay family.
- (e) The plan's §4.7 `getCurrentTabIndex` claim was loose; not repeated here.
- (f) §6 chip-exit drag enumeration: the gating is uniform across all sub-branches; the compose chip-exit is a cross-tab tap (a compose chip-exit drag does not occur, since the source list is cached).
- (g) Cancel slide-back: `swipeNeedsLoadingAtStart` stays true until the transitionend reset, but the at-rest sub-branch publishes `0` anyway; behavior correct.
- (h) Chip-exit e2e uses `/activity` (a cross-tab target); the preload micro-task window is sub-frame for a warm target, so the test guards the post-preload window (the preload window is guarded structurally by `swipeNeedsLoadingAtStart` being set alongside `isPendingNavigation`). The test asserts the overlay mounted for ≥ 1 frame so it is non-vacuous.
- (i) §7 enumerates `route-config.ts` as an unchanged verification target.

### Deviations from the plan

Two, both resolved in the RV16-C00 revision (below). (1) Plan §7 committed a second chip-exit test variant for an overlay route (deep branch); the initial implementation shipped only the compose (centerTab) variant, so the overlay `/bookmarks` cross-tab chip-exit test was added. (2) The discrete-back timing is an intentional improvement (carried note (d)), not the plan §6.3 "Preserved" wording; plan §6.3 is aligned in this revision. Otherwise the implementation follows the Round-2/3-approved plan: `foregroundFraction` collapse + GPL `coverProgress` gating + `chipExitActive` reverted to list-only + the documented docstring/test scope.

### RV16-C00 revision (post-audit fixes)

The RV16-C00 audit (`docs/RV16-C00-Audit-01.md`) returned **5/5 acceptable, zero blocking** (all high confidence). The convergent non-blocking concerns were applied:

- Added the overlay `/bookmarks` cross-tab chip-exit test (`e2e/fab-compose-backswipe.spec.ts`) - plan §7's committed second variant, covering the GPL deep-branch gating the compose (centerTab) test does not reach.
- Refreshed the `isComposeRoute` docstring (`route-config.ts`) and reworded the `coverProgress` field docstring (`mobile-pager.svelte.ts`) to drop the awkward double-paren.
- Aligned plan §6.3 (discrete-back timing is an intentional improvement, not "Preserved").
- Corrected this journal's GPL gate line numbers (`:386`/`:423`/`:432`/`:441`), the Verify lint-section import claim (the import was reformatted by the formatter, not "unchanged"), and the Deviations section.

Re-verify: `bun run check` 0/0; the FAB e2e suite is **39 pass / 0 fail** (the 5 compose-spec tests include the new overlay chip-exit variant).

## Verify

- `bun run check` (svelte-check + tsc): **0 errors / 0 warnings** across 1430 files.
- `bun run lint`: the chain exits non-zero on 9 PRE-EXISTING doc prettier nits (`DV13-*`, `DV14-*`, `DV15-*`, `RV14-*`, `RV15-*`; none touched by DV16). All DV16-touched files are prettier-clean (`prettier --check` on each passes). The `GesturePageLayout.svelte` import block was reformatted to multi-line by the formatter (the single-line form on master exceeded printWidth); the reformatted form is prettier-clean and is an incidental format fix, not a DV16 logic change. eslint **0 errors** on the DV16-touched files. similarity-ts type-duplicates **0** (the 47 similar-type pairs are pre-existing `DiscussionsTabData`/`BookmarkListItem` etc., unrelated to FAB).
- `bun test src/`: **202 pass / 0 fail** (1289 expect() calls).
- `bunx playwright test e2e/fab-compose-backswipe.spec.ts e2e/fab.spec.ts e2e/fab-deep-page-boundary.spec.ts`: **39 pass / 0 fail**. The 5 compose/chip-exit tests pass (CALIBRATION, 2 back-swipe, 2 chip-exit incl. the overlay deep-branch variant); the 34 overlay/list/SSR FAB regression tests pass (the GPL `coverProgress` gating does not regress the overlay back-swipe, the deep→deep back-swipe, the forward thread/deep enter, or the SSR scale-0 renders).
- Full e2e suite (`bunx playwright test`, pre-revision snapshot): **172 pass / 2 fail**. Both failures are `e2e/header-title-crossfade-clip.spec.ts` DEFECT tests, a PRE-EXISTING open defect (memory `header-title-crossfade-clip-defect.md`, OPEN 2026-06-30, identical error signature `bar[h=56] clip[h=40] inset(8,8) spanCutAtInset=true`). DV16 does not touch the Header title crossfade, and the GPL change gates only `coverProgress` (FAB-only consumer), so it cannot cause these failures. DV16 introduces **zero** new e2e failures. (The post-revision FAB subset above is 39/0; the +1 overlay chip-exit test added in the RV16-C00 revision is the only delta and is covered by that subset run.)

## Organic-clean gate (verified)

`git diff` against the shared primitives:

- `GesturePageLayout.svelte`: ONLY the three `coverProgress` gating ternaries + two comment updates. No `fractionalIndex`/`dragging`/`backMorph`/`targetIndex` change. No `fab`/`post`/`messages`/`discussions` token added (`swipeNeedsLoadingAtStart` and `coverProgress` are general GPL/store concepts).
- Every other shared primitive (`swipe.ts`, `tab-config.ts`, `mobile-tabs.ts`, `navigation-logic.ts`, `navigation.svelte.ts`, `scroll-chrome.svelte.ts`, `Header.svelte`, `MobileTabBar.svelte`, `(tabs)/+layout.svelte`, `DualColumnLayout.svelte`, `+layout.server.ts`, `app.css`, `MobileTabPager.svelte`, `route-config.ts`, `mobile-pager.svelte.ts`, `AppShell.svelte`, root `+layout.svelte`): zero functional diff. `FloatingActionButton.svelte` and `fab-scale.ts` receive docstring touch-ups only.

## Concerns for RV16-C00 reviewers to scrutinize first

1. **The GPL `coverProgress` gating across all four publish paths.** Confirm the gating is `swipeNeedsLoadingAtStart ? 0 : <value>` at the centerTab publish (`:386`) and the two deep publishes (`:423`, `:432`), and that `backMorph`/`fractionalIndex` are untouched. Confirm `swipeNeedsLoadingAtStart` is the complete discriminator (it maps 1:1 to the `.loading-overlay` render condition at `:1052`).
2. **The chip-exit e2e is non-vacuous.** Confirm the test asserts `overlayFrames.length > 0` (the chip-exit fired) AND `maxOverlayScale < 0.1`, and that it exercises the post-preload window via the `.loading-overlay` DOM key.
3. **No regression to the overlay back-swipe / deep→deep / forward enters.** The 34 non-compose FAB specs pass; confirm the GPL gating does not change `coverProgress` for `swipeNeedsLoadingAtStart === false` paths.
4. **The `foregroundFraction` collapse is exhaustive and compose reads `coverProgress`.** Confirm no code path returns the old constant 0 for compose.

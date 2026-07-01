# DV10 - Audit Round 3

5 independent auditors examined `docs/DV10-Plan.md` (v3) against `43317e6`. Result: **5/5 PASS**. The R2 convergent blocker (B3 centerTab sign) and all six R2 majors (M1–M6) are independently verified FIXED at the code level. Remaining findings are non-blocking implementation details; one convergent major (the store `set()` body) is folded into v3.1.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | PASS    | 0        | 0     | 6     | has-special-cases |
| 2       | PASS    | 0        | 0     | 2     | has-special-cases |
| 3       | PASS    | 0        | 1     | 4     | has-special-cases |
| 4       | PASS    | 0        | 2     | 3     | has-special-cases |
| 5       | PASS    | 0        | 2     | 5     | has-special-cases |

Result line: **5/5 PASS → plan approved for implementation.**

## R2 blocker + majors — independently verified FIXED

- **B3 (centerTab sign).** `GesturePageLayout.svelte:343` `dragProgress = max(0, min(1, -dragOffset/W))` confirmed sign-broken for `swipeDirection === 'right'` (back-swipe, `dragOffset > 0`). v3 computes `coverProgress` from the deep branch's direction-aware normalization (`:374-377`, `val = swipeDirection === 'right' ? rawDragOffset : -rawDragOffset; clamp(val/W, 0, 1)`) on BOTH branches. Bug B now fixed on thread routes too.
- **M1 (optional field).** `coverProgress?: number | null` on `PagerUpdate`; the 6 non-GPL `pager.set` call sites (MobileTabPager ×3, SearchScopePager ×3) + GPL reset (`:889`) compile untouched.
- **M2 (arm-effect family gate).** The arm-effect (`:390-416`) gated `family === 'list'`; overlay never arms a no-op sampler.
- **M3 (helper collapse).** `sampleFraction`/`fractionFromSample` collapse to list-only; `isRestingTarget` drops `familyRestsAtSampleOne`; `pxToFraction`/`listForegroundFromThreadCover`/`familyRestsAtSampleOne` have no remaining call sites in `src/`.
- **M4 (fab-release-snap).** Added to the rewrite list (§7).
- **M5 (double-clock gate).** `transitionEnabled = (!pager.dragging && !samplerActive) || (discreteNavInFlight && !samplerActive)` — the latch is `!samplerActive`-gated, so it cannot double-clock the Family A sampler on overlay→list back-swipe commit.
- **M6 (stale-latch clear effect).** The new effect reads `navStore.navInFlight`; `handleAfterNavigate` (`navigation.svelte.ts:133`) reliably clears it after navigation. The 280 ms timer is the lost-navigation backstop.

R1 blockers remain fixed: `coverProgress` has zero non-FAB consumers (grep); the atom keeps its combined `transform`.

## Convergent major (folded into v3.1, non-blocking)

### MA1 - `set()` body must assign `coverProgress`; v3 §5 only said "add the field" (auditors 3, 4, 5)

`mobile-pager.svelte.ts:51-57` `set()` copies `fractionalIndex/dragging/active/backMorph/targetIndex` explicitly. Adding `coverProgress?: number | null` to the interface without updating `set()` means GPL's `coverProgress` writes never reach the store `$state`, and the GPL reset (`:889`) never clears a stale value. v3.1 §5 specifies the body line: `coverProgress = update.coverProgress ?? null` (mirroring the existing `targetIndex` fallback at `:56`). Also `PagerStore` gains the `$state` declaration + getter mirroring `backMorph`.

## Other majors (folded into v3.1)

- **MA2 (auditor 5 M2).** `fab-scale.test.ts:5-8,69,95` imports and `describe` blocks for `pxToFraction`, `listForegroundFromThreadCover`, `familyRestsAtSampleOne` must ALL be deleted (v3 §7 named only the `familyRestsAtSampleOne` block). v3.1 §7 lists the full deletion.
- **MA3 (auditor 4 major-2).** The thread-route back-swipe e2e (§7) should also sample POST-commit and assert scale stays ≥0.3 (no mid-commit flash to 0), since the centerTab branch publishes `coverProgress = 0` at rest and the swap to the list route's scale 1 is eased by `discreteNavInFlight`.

## Minor findings (noted, most folded into v3.1 wording)

- **restingFraction activeTab resolution (auditor 5 m1).** `restingFraction` for the list family must resolve `activeTab = pager.active ? pager.fractionalIndex : getCurrentTabIndex(page.url.pathname)` so a deep-link SSR renders scale(1) on a list route. v3.1 §4.5 states this.
- **`afterNavigate` is not reactive (auditors 3 N1, 5 m2).** The clear effect reads `navStore.navInFlight` (and `page.url.pathname` for route landing); `afterNavigate` is just the colloquial name for the root-layout hook that clears `navInFlight`. v3.1 §4.3 corrects the wording.
- **deep→deep pop is UN-eased (auditor 5 m3).** `/bookmarks`→`/profile/edit` is overlay→overlay (same family), so `discreteNavInFlight` does NOT arm; the FAB shows one frame at scale 1 (the deep branch's commit `coverProgress = 1`) with no CSS easing. v3.1 §4.1 states this honestly (it is an instantaneous 1→0, not eased), and §7's deep→deep e2e asserts no PERSISTENT flash (a single frame is accepted).
- **centerTab disarm guards become dead code (auditor 3 finding 2).** With the arm-effect gated `family === 'list'`, the `:411` disarm-guard (`pager.dragging && !familyNeedsSamplerDuringDrag(family)`) is now unreachable (only list arms, and list always returns true). v3.1 §4.5 notes it is retained as defensive dead code for a future family, or deleted.
- **chip-exit priority must be re-stated (auditor 1 N3).** The new `foregroundFraction` must still test `chipExitActive` FIRST (force 0 during a cross-tab chip-exit) before reading `coverProgress`. v3.1 §4 re-states the precedence.
- **`fab-release-snap` rationale value correction (auditor 5 m4).** The 50 px cancel starts at ~0.87 under the identity curve (was ~0.75 under `2f-1`, not ~0.93). Comment-only.
- **thread test should cover `/messages/<id>` too (auditor 5 m5).** centerTab={2} shares the branch; one test suffices but §7 notes the parity.

## Organic verdict

All five auditors return `has-special-cases`, consistent with R1/R2. The two pragmatic special-cases — the Family A sampler (second scale path, justified by MobileTabPager's release-jump) and the `discreteNavInFlight` timer latch — are honestly documented with a deferred-cleanup path (§4.5: MobileTabPager publishes a continuous snap-progress so Family A also drops the sampler). The overlay family is now a pure function of the live `coverProgress` signal (no sampler, no holdover, no gap-holdover). This is the approved tradeoff; no further convergence is blocked.

## Approval

The plan is approved for implementation. The v3.1 amendment folds in MA1 (set body), MA2 (full fab-scale.test.ts deletion), MA3 (post-commit thread e2e), and the minor wording corrections so the blueprint is complete.

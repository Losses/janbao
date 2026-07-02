# DV16 - Audit Round 2

5 independent open-ended auditors (no roles, no steering, read-only, no e2e, no git mutation) re-examined `docs/DV16-Plan.md` (Round-1 revision: foregroundFraction collapse + chipExitActive extension + documentation surface + strengthened tests) against the codebase at `master`. Result: **1/5 PASS, 4/5 changes_requested** (auditor 3 PASS; auditors 1, 2, 4, 5 changes_requested). All five agreed the `foregroundFraction` collapse (§4.2) is correct and thorough for the drag back-swipe. Four of five converged on a single structural blocker: the §4.6 `chipExitActive` extension is the wrong fix location.

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence |
| ------- | ----------------- | -------- | -------- | ------- | ---------- |
| 1       | changes_requested | 1        | 4        | clean   | high       |
| 2       | changes_requested | 2        | 4        | clean   | high       |
| 3       | PASS              | 0        | 3        | clean   | high       |
| 4       | changes_requested | 2        | 4        | clean   | high       |
| 5       | changes_requested | 2        | 5        | clean   | high       |

Result line: **1/5 PASS → revised.**

## Blocking issues (deduplicated)

### B1 - chipExitActive extension does not cover the GPL chip-exit preload window (auditors 2, 4, 5)

`GesturePageLayout.svelte:771-785`: the cross-tab chip-exit `beforeNavigate` path sets `isPendingNavigation = true` synchronously, then calls `navStore.setPendingNav(target, type)` only inside `preloadData(target).then(...)`. Between the synchronous assignment and the `.then` callback (the preload window), `navStore.pendingNav === null` and `navStore.navInFlight === false`. The GPL pager `$effect` reads `isPendingNavigation` into `committed` (`:345-348`) and, with `dragOffset === null`, publishes `coverProgress = 1` (`:368` centerTab, `:423` deep). The proposed §4.6 `chipExitActive` keys on `navStore.pendingNav !== null`, so during the preload window it returns false for compose/overlay; with the §4.2 collapse, compose reads `coverProgress ?? 0 = 1`, `scale = 1`, and the discussions-icon FAB (z-35) renders above the GPL z-30 LoadingChip (`:1043-1063`, armed by `isPendingNavigation`). Today's constant-0 branch hides the FAB throughout, so this is a new compose regression for the preload duration. The plan's "Fixed (was latent for overlay; new-closed for compose)" claim covers only the post-`pendingNav` window.

### B2 - chipExitActive's getCurrentTabIndex check misfires on same-family deep→deep back-swipes (auditors 1, 3)

The proposed `getCurrentTabIndex(pending.href) !== cfg.tabIndex` returns `true` not only for cross-tab chip-exits but also for any back-swipe whose `pendingNav` target is a non-tab route, because `getCurrentTabIndex` returns `-1` for non-tab paths and `-1 !== cfg.tabIndex` always. This affects every deep route reached via the `fallbackRoute` pattern with no `leftHref` (`/profile/edit`, `/profile/appearance`, `/profile/password`, `/admin/user-groups`, etc.). For a deep→deep back-swipe (e.g. `/profile/edit → /profile/settings`) there is NO LoadingChip (`swipeNeedsLoadingAtStart === false`; the GPL renders a real `getPreviewPanel` preview at `:968-1003`), yet the extension forces the FAB to scale 0 throughout, regressing the overlay deep-page back-swipe that today scales in via `coverProgress`. The existing `fab-deep-page-boundary.spec.ts` tests do not catch this because `openSidebarAndGoto` from `/` makes the back-stack `['/', deep]`, so the back-swipe target is the tab root `/` rather than a deep page. Auditor 3 rates the visual impact acceptable (the FAB is heading to scale 0 anyway) but agrees the plan's safety claim is incomplete.

### B3 - the §7 chip-exit e2e assertion cannot detect B1 (auditors 2, 4, 5)

The proposed assertion `maxScaleDuringChipExit < 0.1 while navStore.pendingNav targets a different tab` samples only the post-preload window (after `setPendingNav` fires). With a cached cross-tab target the preload resolves between Svelte flushes with no intervening paint, so the assertion passes trivially while the regression persists for uncached targets (real users, slow networks). The testing strategy does not discriminate the preload window.

## Root cause (the Round-1 revision fixed the wrong layer)

`coverProgress` semantically represents "how much the source list is revealed." During a chip-exit (`swipeNeedsLoadingAtStart === true`) the source list is NOT revealed (a LoadingChip stands in for the unmounted target page), yet the GPL publishes `coverProgress = 1` (the committed branch) or the raw drag fraction (the drag branch). Every consumer of `coverProgress` (only the FAB layer, grep-confirmed) therefore misreads "list fully revealed" during a chip-exit. The Round-1 `chipExitActive` extension patched the consumer with a `pendingNav`-keyed gate that (a) misses the preload window (B1) because `pendingNav` is set only after `preloadData` resolves, and (b) misclassifies non-tab pendingNav targets (B2). Auditor 5 notes explicitly that the preload-window signal (`isPendingNavigation`) is GPL-local `$state` not exposed to the FAB layer, so the defect cannot be closed inside the organic-clean boundary at the consumer.

## Convergent non-blocking concerns

- **§3.7 / §4.7 wrong section reference (auditor 2).** §3.7 says "§4.7 closes the gap for both" but the chipExitActive extension is in §4.6; §4.7 is Organic integration.
- **Stale inline comment (auditors 2, 4).** `FloatingActionButtonLayer.svelte:22-23` says "`scaleFromFraction` maps foregroundFraction 1:1 over [0,1]"; the actual map is `clamp(2·f − 1, 0, 1)` (the second half). In scope for the comment-accuracy gate.
- **§4.3 "whole class removed" is inaccurate (auditor 5).** The Round-1 `chipExitActive` retains the list-only `navInFlight && direction === 'forward'` fallback, so the FAB-layer family special-casing is only partially removed.
- **GPL onMount cleanup does not reset coverProgress (auditor 5).** `GesturePageLayout.svelte:926` resets `fractionalIndex/dragging/active/backMorph` but not `coverProgress`. If a swipe is in flight (cover = 1) when the GPL unmounts and the next route reads `displayConfig.family === 'compose'` via `retainedConfig`, `coverProgress` is briefly stale. `MobileTabPager`'s next `pager.set` nullifies it (`mobile-pager.svelte.ts:63`), so the window is sub-frame; low impact, but the §6.11 "acknowledged dependency" understates it.
- **`/messages/new` parity is statically resolvable now (auditors 1, 3).** `MessageCompose.svelte:119` (`centerTab={2}`) takes the same centerTab branch; the DEFECT (messages) test is the empirical guard. Move from UNVERIFIED to resolved.

## Verified-TRUE (all five, carry forward)

The `foregroundFraction` collapse (§4.2) is correct, TypeScript-exhaustive, and thorough for the drag back-swipe defect. Every line citation matches the code. Compose is the only GPL-mounted family that ignores `coverProgress` today (grep confirms). The preventive e2e (`fab-compose-backswipe.spec.ts`) is tautology-resistant. The Round-1 `chipExitActive` logic is correct for the 9 cases it intends to cover (family × pendingNav state × list-forward); the failure is structural - `pendingNav` is the wrong signal for the preload window, and `getCurrentTabIndex` is the wrong discriminator for non-tab targets.

## Revision decisions

The Round-2 revision of `docs/DV16-Plan.md` moves the chip-exit fix from the FAB consumer to the GPL source:

1. **Fix `coverProgress` at the GPL source (B1, B2, B3).** In both the centerTab branch (`GesturePageLayout.svelte:341-381`) and the deep branch (`:382-434`), gate the published `coverProgress` on `swipeNeedsLoadingAtStart`: during a chip-exit (`swipeNeedsLoadingAtStart === true`), publish `coverProgress: 0` in the drag and committed sub-branches (the at-rest sub-branch already publishes 0). This reflects that a chip-exit does not reveal the source list. The preload window (`isPendingNavigation`) is covered because `swipeNeedsLoadingAtStart` is set in the same `beforeNavigate` path (`:772`) before `isPendingNavigation`. The deep→deep back-swipe (B2) is unaffected because `swipeNeedsLoadingAtStart === false` there (the target has a `previewPanel`). The same fix closes the overlay/thread latent chip-exit gap (deep + centerTab branches).
2. **Revert the `chipExitActive` extension.** With `coverProgress` correct at the source, the FAB reads the right value directly; the `chipExitActive` family guard returns to its Round-0 list-only form (it still handles the MobileTabPager chip on list routes, which is a separate chip the GPL does not own).
3. **Test the preload window.** §7 adds a chip-exit e2e that asserts the FAB stays at scale 0 across the FULL chip-exit window (preload + post-preload) for compose, using an uncached cross-tab target (e.g. cold-cache `/activity`) so the preload window actually paints. A second assertion covers an overlay route (same class). The probe keys on the `.loading-overlay` DOM presence (the chip), not on `pendingNav`, so the preload window is sampled.
4. **Comment-accuracy + references.** §5 adds the `FloatingActionButtonLayer.svelte:22-23` "1:1" inline comment to the refresh list. §3.7 / §4.x section references corrected. §4.3 rephrased: the compose special-case in `foregroundFraction` is removed; the chip-exit correctness moves to the `coverProgress` source, so no FAB-layer family special-casing remains in the gesture-signal path (the list-only `chipExitActive` fallback handles the MobileTabPager chip, a different surface).
5. **Edge cases.** §6 acknowledges the GPL onMount `coverProgress` cleanup gap (sub-frame stale window, nullified by the next `pager.set`).

The `foregroundFraction` collapse, the `discreteNavInFlight` CSS latch, the SSR/resting scale 0, the deep-link no-flash, and the out-of-scope pager-contract unification are unchanged. The change now touches one shared primitive (`GesturePageLayout.svelte`) but injects no FAB-named tokens (`swipeNeedsLoadingAtStart` is a general GPL chip-exit concept; `coverProgress` is a general reveal-progress signal); the DV09 organic-clean gate holds.

Round 3 audit will re-verify the whole plan, with attention to the GPL `coverProgress` gating's correctness across the centerTab and deep branches, the deep→deep back-swipe, the forward thread-enter, and the SSR/resting states.

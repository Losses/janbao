# DV16 - Audit Round 3 (FINAL)

5 independent open-ended auditors (no roles, no steering, read-only, no e2e, no git mutation) re-examined `docs/DV16-Plan.md` (Round-2 revision: `foregroundFraction` collapse + GPL `coverProgress` chip-exit gating at the source + `chipExitActive` reverted to list-only) against the codebase at `master`. Result: **5/5 PASS (FINAL, unconditional, all organic=clean, all high confidence, zero blocking)**. Loop-exit condition met.

## Tally

| Auditor | Verdict | Blocking | Concerns | Organic | Confidence |
| ------- | ------- | -------- | -------- | ------- | ---------- |
| 1       | PASS    | 0        | 4        | clean   | high       |
| 2       | PASS    | 0        | 5        | clean   | high       |
| 3       | PASS    | 0        | 4        | clean   | high       |
| 4       | PASS    | 0        | 5        | clean   | high       |
| 5       | PASS    | 0        | 5        | clean   | high       |

## Verified-FIXED across the audit loop (blocker progression)

- **Round 1.** The plan's audit gate forbade the comment updates the fix makes necessary (the file header and adjacent docstrings would go stale); and §6.5 "Unaffected" for the cross-tab chip-exit was false (the FAB would paint above the GPL chip). Fixed by scoping the documentation surface and attempting a `chipExitActive` extension.
- **Round 2.** The `chipExitActive` extension was the wrong layer: it missed the chip-exit preload window (`pendingNav === null` during `isPendingNavigation`) and misfired on deep→deep back-swipes (`getCurrentTabIndex` returns -1 for non-tab targets). Fixed by reverting `chipExitActive` to list-only and gating `coverProgress` on `swipeNeedsLoadingAtStart` at the GPL source, which covers the preload window (the flag is set alongside `isPendingNavigation`) and avoids the deep→deep misfire (the flag is false when the target has a `previewPanel`).
- **Round 3.** The Round-2 revision verified correct across all traced scenarios: compose back-swipe (flag false, FAB follows finger), deep→deep (flag false, FAB scales in), cross-tab chip-exit preload + post-preload (flag true, FAB hidden), deep chip-exit drag (flag true, FAB hidden), forward nav (flag never set, at-rest 0), SSR (coverProgress null, scale 0). `swipeNeedsLoadingAtStart` is the complete discriminator (it maps 1:1 to the LoadingChip render condition at `GesturePageLayout.svelte:1043`). The gating changes only `coverProgress`; `fractionalIndex`/`dragging`/`backMorph`/`targetIndex` are unchanged. Organic-clean (one shared primitive touched, no FAB-named tokens). No new defects found.

## Confirmed product-correctness (all 5, Round 3)

- The `foregroundFraction` collapse (overlay + compose read `coverProgress`) is TypeScript-safe (unconditional final return) and makes the compose FAB follow the finger during a drag back-swipe.
- The GPL `coverProgress` gating (publish 0 when `swipeNeedsLoadingAtStart`, in the centerTab + deep drag/committed sub-branches) hides the FAB during any chip-exit for every GPL family (compose, thread, deep), closing the compose regression and the overlay/thread latent gap, without regressing the normal back-swipe, deep→deep, forward nav, SSR, or the at-rest state.
- `chipExitActive` returns to its Round-0 list-only form; it still handles the MobileTabPager chip (a separate surface).
- The preventive e2e is tautology-resistant: the drag-back probe keys resolved `getComputedStyle(fab).transform` to the live pathname; the chip-exit probe keys the window to the `.loading-overlay` DOM (not `pendingNav`), so the preload window is sampled.

## Carried-to-implementation notes (non-blocking, NOT re-audited)

These are accuracy/scope refinements for the implementer, recorded by the Round-3 auditors; none changes the approved design.

- (a) **§6.13 corrected in the plan.** The onMount cleanup at `GesturePageLayout.svelte:926` DOES nullify `coverProgress` (the store's `set` at `mobile-pager.svelte.ts:63` applies `?? null`), so there is no stale window. The plan's §6.13 was rewritten to state this.
- (b) **Docstring refresh scope is wider than §5's primary list.** Refresh alongside `FloatingActionButtonLayer.svelte:22-23` and `:15-39`, `FloatingActionButton.svelte:12-17`, `fab-scale.ts:64-75`: also `fab-scale.ts:8-11` (file header repeats the "1:1 over the full range" inaccuracy - the actual map is `clamp(2·f − 1, 0, 1)`, the second half), `mobile-pager.svelte.ts:35-38` (the `coverProgress` docstring says "FAB-only overlay cover progress"; reword to describe the reveal-progress semantic so it matches the §4.6 gating rationale), and the `fab-scale.test.ts:75-77` test label ("Family C (compose) -> false (no sibling track to sample)") so it stays consistent with the refreshed `familyNeedsSamplerDuringDrag` docstring. All are FAB-named or store files; no shared-primitive logic change.
- (c) **centerTab branch has a single `coverProgress` publish point.** `GesturePageLayout.svelte:373-380` publishes `coverProgress: cover` once for the whole centerTab branch (cover is computed in the drag/committed/at-rest sub-branches above it). The cleanest gating is one line - `coverProgress: swipeNeedsLoadingAtStart ? 0 : cover` at `:379` - not three sub-branch edits. The deep branch has two publish points (`:414` drag, `:423` committed) that each need the gate. (The at-rest sub-branches `:369-372` and `:426-433` already publish 0.)
- (d) **§6.3 discrete-back timing is an intentional improvement, not "Preserved".** The discrete back (`page.goBack()`) previously held scale 0 through the slide and eased 0→1 after the swap (~400ms total); after the fix it reads `coverProgress = 1` during the committed slide and the CSS ease runs during the slide (~200ms), matching the overlay family. The plan's "Preserved" wording masks this; the implementer should state it as an intentional change in the journal.
- (e) **§4.7 `getCurrentTabIndex` claim.** `getCurrentTabIndex` returns -1 for any non-tab path, so the list-only `chipExitActive` check returns true for any non-tab `pendingNav` target (a pre-existing imprecision in the Round-0 form, out of scope per §8, not introduced by DV16). The plan's "correct because list-route pendingNav targets are tab roots" wording is loose; the implementer should not repeat it.
- (f) **§3.7 / §6 chip-exit drag enumeration.** The LoadingChip render condition at `GesturePageLayout.svelte:1043` is `swipeNeedsLoadingAtStart && isMobile && (dragOffset !== null || isPendingNavigation || isTransitioningOut)`; the `dragOffset !== null` disjunct covers the chip-exit DRAG case. §6 should enumerate the compose chip-exit drag (deep-linked `/post/discussion` with an uncached back target) alongside the tap variant at §6.5. The gating covers it uniformly.
- (g) **Cancel slide-back.** During a cancelled drag's slide-back, `swipeNeedsLoadingAtStart` stays true until the transitionend reset at `:722`, but the chip is not shown (the render condition's other disjuncts are false). The at-rest sub-branch publishes `coverProgress: 0` anyway, so the behavior is correct; a documentation note suffices.
- (h) **§9 chip-exit e2e cold-cache.** The chip-exit e2e must use a genuinely cold cross-tab target (e.g. `/activity` with the activity cache cleared for the worker) so the preload window paints at least one frame; a cached target may resolve between Svelte flushes with no paint. Add a cache-reset in `prepareContext` or pick a route the worker has not warmed.
- (i) **§7 explicitly list `route-config.ts` audit gate** (diff empty) for parity with the other unchanged primitives.

## Loop-exit

Plan-audit loop exit: **5/5 PASS (FINAL)**. DV16-Plan approved for implementation (3 rounds: R1 3/5, R2 1/5, R3 5/5). Implementation proceeds under `docs/DV16-C00-Journal.md` + `docs/RV16-C00-Audit-NN.md` (per the DV09 pattern).

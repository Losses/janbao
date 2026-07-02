# DV16 - Plan Journal

Append-only log of the 5-agent open-ended audit loop for the compose-family FAB back-swipe fix. Each round: 5 independent auditors (no roles, no steering, read-only, no git mutation of the shared worktree) examine `docs/DV16-Plan.md` against the real codebase and the working-tree diff; loop until 5/5 unconditional PASS (DV04 / DV09 pattern). The defect this plan corrects was analyzed and reproduced empirically before drafting (the regression spec `e2e/fab-compose-backswipe.spec.ts` already records the buggy trajectory on the current code).

## Round 0 - initial draft

The plan was drafted after a static trace of the FAB scale data flow and an empirical reproduction of the defect.

What is fixed and why:

- **Defect.** `FloatingActionButtonLayer.svelte` `foregroundFraction` (`:372`) returns the constant `0` for `cfg.family === 'compose'` (`:392-394`), discarding the live `pager.coverProgress` that the overlay branch reads (`:388-390`). During a drag back-swipe from a compose route the FAB scale is therefore pinned at `scaleFromFraction(0) = 0` for the whole gesture and only rises after the route swaps to the list, when the `discreteNavInFlight` CSS latch eases 0 → 1.
- **Underlying cause.** The compose branch was written on the premise that compose routes have no continuous gesture signal. The premise is false: both compose routes mount a `GesturePageLayout` (`src/routes/post/discussion/+page.svelte:116`, `src/lib/components/organisms/MessageCompose.svelte:119`) and publish `coverProgress` continuously during a back-swipe on the `centerTab !== undefined` branch (`GesturePageLayout.svelte:339-381`, cover at `:364`, published at `:379`), identically to overlay routes.
- **Structural fix.** Merge the compose branch into the overlay `coverProgress` read. The `foregroundFraction` derivation then has two signal sources (list reads the Family A sampler; overlay and compose read `coverProgress`), matching the invariant that every GPL-mounted family reads `coverProgress`. Both compose routes flow through the single compose branch, so one change covers every instance.
- **Preventive test.** `e2e/fab-compose-backswipe.spec.ts` drives a real CDP drag back-swipe (not `page.goBack()`) and asserts the FAB scale rises above 0.3 while the URL is still the compose route. This catches the cause pattern (a family branch not reading the live gesture signal) and is tautology-resistant because each sample keys the resolved `getComputedStyle(fab).transform` to the live pathname.

Why the defect survived prior work:

- DV09 delivered the FAB and its three families. The `fab-deep-page-boundary` follow-up folded the deep routes into the overlay `coverProgress` read by giving them `family: 'overlay', kind: 'deep'` (`route-config.ts:76-153`) but did not touch the compose family, which kept its original "discrete-only" design.
- `e2e/fab.spec.ts` "Family C back" (`:581-611`) drives the back from compose via `page.goBack()`, a discrete nav eased by the atom's CSS transition. The drag back-swipe from a compose route was never exercised, so the compose branch's missing live signal was never observed.

Owner-locked decisions carried in from the analysis (not relitigated by the audit):

- The fix is the `foregroundFraction` branch merge only. Unifying the two pagers' progress-signal contracts and retiring the Family A DOM sampler is a separate preventive follow-up on the tab-switch path (out of scope, §8).
- The `family` discriminant is retained; only its `foregroundFraction` consumer changes.
- The regression spec's two DEFECT tests are written as `test.fail` on the buggy code and flip to `test` once the fix lands.

## Round 1 - 3/5 PASS, 2/5 changes_requested → revised

Five independent open-ended auditors examined `docs/DV16-Plan.md` against the codebase at `master`. Result: **3/5 PASS, 2/5 changes_requested** (auditors 2, 3, 4 PASS; auditors 1, 5 changes_requested). All five agreed the core fix (merge the compose branch into the overlay `coverProgress` read) is correct and thorough for the stated defect. Full detail: `docs/DV16-Meeting/DV16-Audit-R1.md`.

Convergent blockers:

- **B1 (auditor 1; auditor 2 concurs).** The plan's §5 / §7 audit gate forbade any source-line change beyond the `foregroundFraction` branch merge, but the fix makes the file header block (`FloatingActionButtonLayer.svelte:15-39`) and two adjacent docstrings (`FloatingActionButton.svelte:12-17`, `fab-scale.ts:67-75`) incomplete. A literal implementer would ship stale documentation that contradicts the code.
- **B2 (auditor 5).** §6.5 marked the cross-tab chip-exit "Unaffected", which is false. `chipExitActive` (`:354-367`) gates only the list family, so after the merge a cross-tab drawer-tap exit from `/post/discussion` reads `coverProgress = 1` (the GPL committed branch) and renders the discussions-icon FAB at scale 1 above the GPL z-30 LoadingChip. This is parity with overlay's latent gap, not an isolated new defect, but the plan must fix it or justify it.

Convergent non-blocking concerns (all five):

- `coverProgress` is `0` at client rest once the GPL `$effect` flushes, not `null`; `null` only on the server and in the pre-mount swap window. The `?? 0` fallback makes the conclusion correct; the prose in §3.3 / §3.5 / §4.4 / §4.5 / §6.4 must distinguish the two states.
- Removing the trailing compose return leaves the derivation non-exhaustive for TypeScript; collapse to a single unconditional `return pager.coverProgress ?? 0` after the `list` early-return.
- The DEFECT test threshold `maxPreSwapScale > 0.3` is met by the commit-slide alone; assert `preSwapIntermediateCount > 0` (already captured, unused) so a ramp is required.
- The retainedConfig fallback (`:194-230`) on a no-FAB-rule route reads `coverProgress`, which is `null` off any mounted GPL; acknowledge the dependency.
- The cancelled-drag case (finger reverses) snaps the scale down without a CSS ease; matches overlay, acknowledge it.
- §9 "discreteNavInFlight unverified" is statically provable; move to resolved.

Revision decisions (applied to `docs/DV16-Plan.md`):

1. **Scope the documentation surface (B1).** §5 "Modified" now explicitly lists the file header block, the inline comment, and the two adjacent docstrings. §7's audit gate is revised to "no other FUNCTIONAL line changes; comment-accuracy updates within FAB-named files are required." No shared primitive is touched.
2. **Extend the fix to `chipExitActive` (B2).** §4.6 lifts the pendingNav cross-tab detection out of the `family === 'list'` guard so it applies to every family: a `pendingNav` whose target tab differs from the FAB's source-list tab forces scale 0 (a LoadingChip covers the content); a same-tab `pendingNav` (normal GPL back-swipe) keeps the FAB driven by `coverProgress`. The list-only `navInFlight && direction === 'forward'` fallback stays. This closes the compose chip-exit visibility and overlay's latent same-cause gap, without regressing the normal back-swipe, the forward tap, or the list family.
3. **TypeScript-safe collapse.** §4.2 / §5 specify the derivation as `list` early-return + unconditional `return pager.coverProgress ?? 0` for overlay + compose.
4. **Strengthen the regression assertions.** §7 adds `preSwapIntermediateCount > 0` to both compose DEFECT tests and to CALIBRATION.
5. **Correct the `coverProgress` prose** in §3.3 / §3.5 / §4.4 / §4.5 / §6.4.
6. **Acknowledge the retainedConfig and cancelled-drag edge cases** (§6.11, §6.12) and the cross-tab chip-exit cases (§6.5, §6.6).
7. **§9 cleanup.** Move `discreteNavInFlight` to resolved; keep `/messages/new` parity and the chip-exit e2e as Round-2 verify items.

The Round-0 owner-locked decision "the fix is the `foregroundFraction` branch merge only" is expanded by revision 2: the same structural move (remove the `family === 'list'` special-case from the gesture-signal path) now applies to BOTH `foregroundFraction` and `chipExitActive`, because B2 showed the compose merge surfaces a chip-exit visibility change that the narrow `chipExitActive` guard caused. The `family` discriminant is still retained (it still drives `discreteNavInFlight`, `effectiveKind` / `displayConfig`, and the list-only chip fallback); collapsing it entirely remains out of scope (§8).

## Round 2 - 1/5 PASS, 4/5 changes_requested → revised

Five independent open-ended auditors re-examined the Round-1 revision. Result: **1/5 PASS (auditor 3), 4/5 changes_requested (auditors 1, 2, 4, 5)**. All five agreed the `foregroundFraction` collapse is correct. Four converged on a single structural blocker: the Round-1 `chipExitActive` extension is the wrong fix location. Full detail: `docs/DV16-Meeting/DV16-Audit-R2.md`.

Convergent blockers:

- **B1 (auditors 2, 4, 5).** The `chipExitActive` pendingNav gate misses the GPL chip-exit preload window. `beforeNavigate` sets `isPendingNavigation = true` synchronously but calls `setPendingNav` only inside `preloadData(...).then(...)` (`GesturePageLayout.svelte:776-784`); the pager `$effect` publishes `coverProgress = 1` during that window, so the collapsed compose branch reads scale 1 and the FAB paints above the z-30 chip. A new compose regression.
- **B2 (auditors 1, 3).** The `getCurrentTabIndex(pending.href) !== cfg.tabIndex` check misfires for same-family deep→deep back-swipes: non-tab targets return -1, so the check forces scale 0 where there is no LoadingChip (the GPL renders a real `previewPanel`). Regresses the overlay deep-page back-swipe.
- **B3 (auditors 2, 4, 5).** The §7 chip-exit e2e keyed on `pendingNav` samples only the post-preload window, so it cannot detect B1.

Root cause (the Round-1 revision fixed the wrong layer). `coverProgress` means "source list reveal progress," but the GPL publishes `1` during a chip-exit when the source list is not revealed (a LoadingChip covers it). The Round-1 consumer-side gate patched this with the wrong signal (`pendingNav` misses the preload window) and the wrong discriminator (`getCurrentTabIndex` misclassifies non-tab targets). Auditor 5 noted the preload signal (`isPendingNavigation`) is GPL-local and not exposed to the FAB layer, so the defect cannot be closed inside the organic boundary at the consumer.

Revision decisions (applied to `docs/DV16-Plan.md`):

1. **Fix `coverProgress` at the GPL source.** §4.6 gates the published `coverProgress` on `swipeNeedsLoadingAtStart` in both the centerTab and deep branches (drag + committed sub-branches): publish `0` during a chip-exit, the computed value otherwise. This covers the preload window (`swipeNeedsLoadingAtStart` is set alongside `isPendingNavigation`), avoids the deep→deep misfire (`swipeNeedsLoadingAtStart === false` when the target has a `previewPanel`), and closes the overlay/thread latent gap (both branches gated). One shared primitive touched; no FAB-named token injected.
2. **Revert the `chipExitActive` extension.** §4.7 returns it to the Round-0 list-only form; with `coverProgress` correct at the source the FAB reads the right value directly. It still handles the MobileTabPager chip (a separate surface).
3. **Test the preload window.** §7 adds a chip-exit e2e keyed on the `.loading-overlay` DOM (not `pendingNav`) using an uncached cross-tab target, so the preload window paints and the assertion `scale < 0.1` covers the whole window.
4. **Comment accuracy + references.** §5 adds the `FloatingActionButtonLayer.svelte:22-23` "1:1" comment refresh; §3.7/§4.x section references corrected; §4.3 rephrased (the compose foregroundFraction special-case is removed; the chip-exit correctness moves to the `coverProgress` source).
5. **Edge cases.** §6 acknowledges the GPL onMount `coverProgress` cleanup gap (sub-frame stale window).

The Round-1 owner-locked decision to extend `chipExitActive` is superseded: the chip-exit fix moves from the FAB consumer to the GPL source, because Round 2 showed the consumer-side gate cannot correctly detect the preload window or distinguish non-tab back-swipe targets. The `family` discriminant is still retained (§8).

## Round 3 - 5/5 PASS (FINAL, unconditional). Loop exit.

Five independent open-ended auditors re-examined the Round-2 revision. Result: **5/5 PASS (FINAL, all organic=clean, all high confidence, zero blocking)**. Full detail: `docs/DV16-Meeting/DV16-Audit-R3.md`.

All five verified the GPL `coverProgress` gating is correct across every traced scenario: compose back-swipe (`swipeNeedsLoadingAtStart` false, FAB follows finger), deep→deep (false, FAB scales in), cross-tab chip-exit preload + post-preload (true, FAB hidden), deep chip-exit drag (true, FAB hidden), forward nav (flag never set, at-rest 0), SSR (`coverProgress` null, scale 0). `swipeNeedsLoadingAtStart` maps 1:1 to the LoadingChip render condition (`GesturePageLayout.svelte:1043`), so it is the complete discriminator. The gating changes only `coverProgress`; `fractionalIndex`/`dragging`/`backMorph`/`targetIndex` are unchanged. Organic-clean (one shared primitive touched, no FAB-named tokens).

The Round-2 root-cause move (chip-exit correctness from the FAB consumer to the `coverProgress` source) eliminated both Round-2 blockers at their common cause: the preload window is covered because `swipeNeedsLoadingAtStart` is set alongside `isPendingNavigation`, and the deep→deep misfire is avoided because the flag is false when the target has a `previewPanel`.

Carried-to-implementation notes (non-blocking, NOT re-audited): see `docs/DV16-Meeting/DV16-Audit-R3.md` items (a)-(i). The notable ones: §6.13 was rewritten (the onMount cleanup DOES nullify `coverProgress` via `mobile-pager.svelte.ts:63`'s `?? null`); the docstring refresh scope widens to `fab-scale.ts:8-11`, `mobile-pager.svelte.ts:35-38`, and the `fab-scale.test.ts:75-77` label; the centerTab branch gates at the single publish point `:379` (deep branch at `:414`/`:423`); the discrete-back timing is an intentional improvement (ease runs during the slide, ~200ms, matching overlay); the chip-exit e2e must use a genuinely cold cross-tab target.

Loop-exit condition met. Plan approved for implementation (3 rounds: R1 3/5, R2 1/5, R3 5/5).

Implementation proceeds under `docs/DV16-C00-Journal.md` + `docs/RV16-C00-Audit-NN.md` (per the DV09 pattern).

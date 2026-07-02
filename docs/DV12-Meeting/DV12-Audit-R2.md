# DV12 - Audit Round 2

5 independent role-less auditors examined the revised `docs/DV12-Plan.md` (R2 primary: remove the whole `(navStore.navInFlight && !settling)` term from `slideT`, Header-local, branch-agnostic) against the codebase at `master`. Result: **4 PASS, 1 FAIL. NOT 5/5 unconditional PASS. Loop continues.** The mechanism itself was judged sound by all 5; the single FAIL (and a non-blocking flag from a PASS auditor) converge on one plan-internal inconsistency about the CALIBRATION test, plus a citation calibration.

## Tally

| Auditor | Verdict | Blocking                            | Organic | Confidence |
| ------- | ------- | ----------------------------------- | ------- | ---------- |
| 1       | PASS    | 0                                   | clean   | high       |
| 2       | PASS    | 0                                   | clean   | high       |
| 3       | FAIL    | 1 (§5/§7 CALIBRATION contradiction) | concern | high       |
| 4       | PASS    | 0 (non-blocking CALIBRATION flag)   | clean   | high       |
| 5       | PASS    | 0                                   | clean   | high       |

Result line: **4/5 PASS, 1/5 FAIL. Round 2 fails the loop-exit condition.**

## Central claims (5/5 convergent VERIFIED)

All five verified the three load-bearing claims of the R2 mechanism by independent source trace:

- **Gesture-settle byte-identical after term removal.** On a gesture commit, `settling=true` is held through the entire `navInFlight=true` window because Effect D (`Header.svelte:351-362`) clears `settling` only when `pendingNav===null && !navInFlight`; at the landing flush `afterNavigate` has not fired yet so `navInFlight=true` and `settling` is still true. The term `(navInFlight && !settling)` is therefore `(true && false) = false` at every frame of the gesture path today; removing it changes nothing. On the click path `settling` is never set (no preceding gesture), so the term is `(true && true) = true` and is the sole cause of the landing jump. The term distinguishes exactly the two paths. (Auditor 1 supplied the decisive flush-by-flush proof; auditors 2, 4, 5 concur.)
- **`runSettleDriver` single-jump.** `settleProgress = settleTarget` is written in ONE `requestAnimationFrame` (`Header.svelte:429`); there is no per-frame interpolation. The CSS transition animates that single jump, so `slideT` must stay `'200ms'` during settle (which it does, today and after R2). Variant B (`dragging || searchScrubbing || settling`) would force `'none'` during settle and snap the gesture release - correctly rejected. Auditor 5 (who proposed Variant B in R1) explicitly retracts it.
- **Defect fixed, both branches.** Both GPL exit branches call `setPendingNav` (`:783` cross-tab, `:813` same-panel) → `executePendingNav` → `navInFlight=true` at landing while `currentHasTabs` flips. Today `slideT='none'` (jump); after R2 `slideT='200ms'` (animates). Branch-agnostic.
- **Compositor immunity.** A `transform` transition, once committed, runs on the compositor and is not broken by the main-thread block; the headless three-frame gap was caused by `slideT='none'` (no transition), not a dropped transition. (All 5; Auditor 5 added the caveat that this holds because the tabs-layer div is always rendered with no `display:none` ancestor and the parent `<header>` transform is stable at landing.)
- **Completeness.** The §9 "undesirable animation" case is resolved: GPL `beforeNavigate` only animates exits to tab roots (`:751`), so `navInFlight=true && settling=false` on a click only occurs for tab-root landings where animating `morph 0→1` is desired. No residual undesired-animation path. (Auditors 1, 5.)

## Convergent blocker (the revision driver)

- **[B1, Auditor 3 blocking + Auditor 4 non-blocking] §5/§7 CALIBRATION contradiction.** The plan lists `e2e/header-tab-descent-cross-tab-exit.spec.ts` under §5 "Unchanged (verification targets)" and only `Header.svelte` as Modified, then §7 says "CALIBRATION (must keep passing)." But the CALIBRATION test asserts `backLanding.slideNone === true` (the BROKEN behaviour; its name is "documents the asymmetry"). After the fix `slideNone` flips to `false`, so CALIBRATION FAILS. The plan cannot simultaneously keep CALIBRATION passing, keep the spec unchanged, and fix the defect. The plan author conflated "documents the asymmetry" (current) with "documents the symmetry" (post-fix). Resolution (R3): the regression spec IS part of the change - add it to §5 Modified; the CALIBRATION back-landing assertion flips `slideNone` true→false and the test name updates asymmetry→symmetry (the `navInFlight === true` assertion stays; forward-landing assertions stay).

## Citation calibration (the term's origin)

Auditor 3 ran `git blame` and found the `(navStore.navInFlight && !settling)` term (line 194) was added by commit **`23d711b9`** ("fix: Fab not following the gesture", 2026-06-30); only the surrounding `slideT` block lines are from `c2c7616`. The owner re-verified: `git blame -L 194,194 -- src/lib/components/organisms/Header.svelte` → `23d711b9`. Auditors 1, 2, 5 repeated `c2c7616` without blaming it; Auditor 3 is correct. The R1 plan/journal citation (`c2c7616`) is corrected to `23d711b9` in R3. The term's origin in a FAB-gesture-tracking commit is a signal to add the FAB specs to the no-regression gate as insurance (the term lives in Header's `slideT`, which the FAB does not read, but the bundling warrants the gate).

## Non-blocking (carried)

- `runSettleDriver` `settleProgress` write is at `:429`, not `:428` (auditors 1, 2, 5). Cosmetic off-by-one; corrected in R3.
- §6.2 "sequential, not parallel" reasoning is looser than warranted: the no-double-animation holds because the Header `translateY` (rootLayerStyle) and the GPL `translateX` (trackEl) are independent transforms on different DOM elements, not because of poll timing (`startPendingNavPoll` can dispatch early via the 800ms wall-clock cap or the `trackEl===null` branch). Conclusion unchanged; reasoning tightened in R3. (Auditor 3 N2.)
- `trackStyle`/`searchButtonStyle`/`tabBarStyle` (`Header.svelte:587,599,606`) keep their own `navInFlight` read and stay suppressed during a chip exit; invisible outside `isSearch` (zero delta on `translateX`/`left`/`max-height` on a non-search nav). Documented inconsistency, out of scope. (Auditors 1, 3, 4, 5.)
- The DEFECT spec asserts `slideT !== 'none'` (a slideT-string check), not a monotonic trajectory; the separate "empirical trajectory probe (audit-time)" gate in §7 covers trajectory. (Auditor 1.)
- The `opacity 200ms ease-out` part of `slideT` is a no-op on the tabs layer outside search mode (pre-existing). (Auditor 1.)

## Revision decisions (Round 3 plan)

1. **§5: add `e2e/header-tab-descent-cross-tab-exit.spec.ts` to Modified.** The CALIBRATION test is updated as part of the fix: its back-landing assertion flips `expect(slideNone).toBe(true)` → `.toBe(false)`; the test name/description changes "documents the asymmetry" → "documents the symmetry"; the `navInFlight === true` assertion stays (the fix does not change navInFlight); the forward-landing assertions and the DEFECT test are unchanged.
2. **§7: replace "CALIBRATION must keep passing"** with "CALIBRATION is updated alongside the fix to document the post-fix symmetry (back-landing `slideNone` now `false`); forward-landing expectations unchanged."
3. **§2: correct the citation** `c2c7616` → `23d711b9` ("fix: Fab not following the gesture", 2026-06-30), the commit that added the `(navInFlight && !settling)` term (verified by `git blame -L 194,194`).
4. **§3/§4: correct `runSettleDriver:428` → `:429`** (the `settleProgress = settleTarget` write).
5. **§6.2: tighten the no-double-animation reasoning** to "independent transforms on different elements (Header translateY vs GPL translateX)", not poll timing.
6. **§7: add the FAB specs** (`fab.spec.ts`, `fab-deep-real-interaction.spec.ts`, `fab-release-snap.spec.ts`) to the no-regression suite, given the term's origin in a FAB-gesture-tracking commit.

The R3 mechanism is unchanged (single Header-local term removal, branch-agnostic); R3 is a documentation/scope correction resolving B1 plus citation accuracy.

# DV10 - Audit Round 2

5 independent auditors examined `docs/DV10-Plan.md` (v2) against `43317e6`. Result: **1/5 PASS, 4/5 FAIL**. R1 blockers (B1 `backMorph` overload, B2 atom split) are independently verified FIXED. A new convergent blocker and several major edits force the Round-2 revision.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | PASS    | 0        | 2     | 4     | has-special-cases |
| 2       | FAIL    | 0        | 2     | 4     | has-special-cases |
| 3       | FAIL    | 1        | 2     | 3     | has-special-cases |
| 4       | FAIL    | 1        | 4     | 4     | has-special-cases |
| 5       | FAIL    | 2        | 2     | 4     | has-special-cases |

Result line: **1/5 PASS → revised.**

## R1 blockers — independently verified FIXED

- **B1 (backMorph overload).** `coverProgress` is a new field; grep confirms zero consumers outside the FAB. Header reads `backMorph` only (`Header.svelte:143,206,503`), thread routes stay `'root'` mode with `backMorph === null`. MobileTabBar is gated on `targetIndex !== null` (centerTab publishes `null`). No Header regression.
- **B2 (atom split).** The combined `style:transform={scale() translateY()}` binding (`FloatingActionButton.svelte:70`) and `.fab-transition` class (`:94`) are kept. The SSR regex (`fab.spec.ts:206`), `readFabTransform` (`:831`), and trajectory samplers (`fab-deep-real-interaction.spec.ts:62-65`) all parse the unchanged `transform`. No test breakage from the atom.

## Convergent blocker

### B3 - centerTab `dragProgress` is sign-broken for rightward back-swipes; `coverProgress` stays 0 on thread routes, bug B unfixed (BLOCKING, auditors 1 major, 3, 4, 5)

The plan §4.1 says the centerTab branch publishes `coverProgress = dragProgress`, claiming it is "the same deadzone-free drag progress the deep branch computes." It is not. `GesturePageLayout.svelte:343` computes `dragProgress = Math.max(0, Math.min(1, -dragOffset / viewportWidth))`. For a thread back-swipe (`/discussion/*`→`/`, `/messages/<id>`→inbox) `swipeDirection === 'right'`, `dragOffset > 0` (clamped at `:490`), so `-dragOffset < 0` and `dragProgress` is clamped to **0** through the entire drag. The deep branch (`:374-377`) is direction-aware (`val = swipeDirection === 'right' ? rawOffset : -rawOffset`); the centerTab branch is not. Result: `coverProgress = 0` through the thread back-swipe, `foregroundFraction = coverProgress ?? restingFraction = 0`, scale stays 0 — bug B reproduced unchanged on the two thread route families, which §2.3/§3.4 require fixed. The plan's own §7 thread-route trajectory test would FAIL.

**Revision decision (v3 §4.1):** the centerTab branch computes `coverProgress` with the same direction-aware `rawDragOffset` normalization the deep branch uses (`swipeDirection === 'right' ? rawOffset : -rawOffset`, clamped 0..1), NOT the left-only `dragProgress` variable. This is a real computation, not a reuse.

## Major findings (non-blocking, addressed in revision)

### M1 - `coverProgress` as a required `PagerUpdate` field breaks 6 unlisted `pager.set` call sites (auditors 4 F3, 5 blocking-2)

`backMorph` is a required field on `PagerUpdate` (`mobile-pager.svelte.ts:33`). Adding `coverProgress` as required forces every `pager.set` to provide it: `MobileTabPager.svelte:96,111,112` (3), `SearchScopePager.svelte:113,122,124` (3), `GesturePageLayout.svelte:889` (reset). §5 listed only GesturePageLayout. **Revision (v3 §5):** `coverProgress` is OPTIONAL (`coverProgress?: number | null`) on `PagerUpdate`, store-default `null`. Only GesturePageLayout writes it. MobileTabPager, SearchScopePager, and the reset are untouched.

### M2 - §4.5's claim "the arm-effect never arms the sampler for overlay" is false (auditors 1, 4 F2, 5 M1)

The arm-effect (`FloatingActionButtonLayer.svelte:390-416`) calls `startSampler()` whenever `hasTrack && hasCfg && family !== null && !chipExitActive`, regardless of family. Only the DISARM guard (`:411`) checks `familyNeedsSamplerDuringDrag`, and only during a drag. On overlay non-drag (idle, click-nav), the sampler arms and runs a no-op rAF (its output is ignored because `foregroundFraction` reads `coverProgress`). The plan's literal claim is wrong. **Revision (v3 §4.5):** the arm-effect is gated `family === 'list'` (Family A only), so overlay never arms the sampler at all. This removes the wasted rAF and makes the claim true.

### M3 - removing `pxToFraction`/`listForegroundFromThreadCover`/`familyRestsAtSampleOne` leaves dead branches in their callers (auditors 1 minor, 4 F2/F3, 5 M2)

`sampleFraction()` (`:281`) calls `pxToFraction` in its overlay branch; `fractionFromSample()` (`:294`) calls `listForegroundFromThreadCover` in its overlay branch; `isRestingTarget` (`:348`) calls `familyRestsAtSampleOne`. §5 removed the helpers but not the call-site branches. **Revision (v3 §5):** `sampleFraction`/`fractionFromSample` collapse to their `'list'` body (overlay branches deleted); `isRestingTarget` simplifies to `Math.abs(sample - Math.round(sample))` (the `familyRestsAtSampleOne` ternary collapses).

### M4 - `fab-release-snap.spec.ts` not in the rewrite list; its thresholds are coupled to the `2f-1` curve (auditor 2 major-1)

`fab-release-snap.spec.ts:163-168,186,216,221,244` tunes the commit distance and the `(0.05, 0.30)` band / `gapHi=0.2` to the old curve's ~0.39 release-start scale. Under the identity curve the numbers change; the cancel test's `minScale < 0.9` rationale breaks. **Revision (v3 §7):** add `fab-release-snap.spec.ts` to the rewrite list, re-derive the commit distance and band bounds under the identity curve.

### M5 - `discreteNavInFlight` double-clocks the Family A sampler on overlay→list back-swipe commit (auditor 2 major-2)

On overlay→list back-swipe commit, the source GPL unbinds, the list route's MobileTabPager track binds, the Family A sampler re-arms to span the 200 ms snap, AND the family swap fires `discreteNavInFlight`. With the gate `(!pager.dragging && !samplerActive) || discreteNavInFlight`, both are true → the CSS transition is on while the sampler drives per-frame → double-clock. **Revision (v3 §4.3):** the gate becomes `(!pager.dragging && !samplerActive) || (discreteNavInFlight && !samplerActive)`. The latch never overrides the sampler; it only eases swaps where the sampler is NOT driving (compose, overlay click-nav where the sampler is now family-gated off).

### M6 - `discreteNavInFlight` stale-latch clear effect not in §5 (auditor 4 F4)

The current `familyCInFlight` effect (`:225-249`) clears only on the next family swap. A lost navigation (pendingNav aborted, no family swap) leaves the latch on for 280 ms, masking the next gesture. §4.3 said "cleared by navInFlight false / afterNavigate" but §5 did not list the new `$effect`. **Revision (v3 §5):** add an effect reading `navStore.navInFlight` (and `afterNavigate`) that clears `discreteNavInFlight` and its timer.

## Minor findings (addressed or noted)

- **`coverProgress` deadzone decoupling** (auditor 4 F1). `coverProgress` is deadzone-free (from `rawDragOffset`), but `visualDragOffset` (the visible track) has the 0.2 `HEADER_MORPH` deadzone. The FAB scales during the first 20% while the track is still. This mirrors Header's morph (Header also reads a deadzone-free signal and morphs in the deadzone), so it is consistent: the chrome (Header + FAB) responds first, the content slides after. **Decision:** keep `coverProgress` deadzone-free; document this as intentional chrome/content phasing. Not a blocker.
- **centerTab "1 on commit" is unreachable** (auditor 4 F5, 5 m). The centerTab branch has no commit state (the URL leaves the thread route on commit, GPL unmounts). **Revision (v3 §4.1):** centerTab publishes `coverProgress = progress` during drag and `0` at rest; the "1 on commit" applies only to the deep branch.
- **deep→deep swap pops the FAB** (auditor 4 F6). Both endpoints rest at scale 0, but the deep branch publishes `coverProgress → 1` mid-swap, so the FAB scales up then down. Header gates this with `isDeepToDeep ? 0`. **Revision (v3 §4.1):** note it; accept (both endpoints 0, the pop is symmetric and brief) OR gate `coverProgress` to 0 on deep→deep. Decision: accept and add an e2e asserting no persistent flash.
- **`restingFraction` named but not defined** (auditor 5 m1). **Revision (v3 §4):** define it — overlay/compose = 0, list = `tabFraction(activeTab, tabIndex)`.
- **Family A thresholds under the identity curve** (auditor 4 F8, 5 m2). **Revision (v3 §7):** state the new Family A mid-range expectation explicitly (tab-mid scale ~0.5).
- **`sampledFractionalIndex` retained by the Activity `'dynamic'` fabConfig branch** (`:158-164`) (auditor 2 minor-4). **Revision (v3 §4.5):** note this is a retained Family A consumer.

## Organic verdict

All five auditors return `has-special-cases`. The plan is a real move toward a pure-function drive (overlay reads live `coverProgress`, holdover + gap-holdover removed, full-range curve, R1 overload cleared), but it retains: the Family A sampler as a second scale path, the `discreteNavInFlight` timer latch, and (v2 only) the sign-broken centerTab computation that is not yet a pure function of the gesture. v3 fixes the computation and tightens the latch/sampler interaction; the two pragmatic special-cases (Family A sampler, discrete-nav latch) stay, with honest justification, as the deferred-clean path (§4.5).

## Verified-TRUE facts carried forward

- `GesturePageLayout.svelte:343` centerTab `dragProgress = max(0, min(1, -dragOffset/W))` is sign-broken for `swipeDirection === 'right'` (`dragOffset > 0` → clamped 0).
- `GesturePageLayout.svelte:374-377` deep branch `val = swipeDirection === 'right' ? rawOffset : -rawOffset` is direction-aware — the correct reference computation.
- `mobile-pager.svelte.ts:33` `backMorph` is required on `PagerUpdate`; making `coverProgress` optional avoids the 6 call-site break.
- `FloatingActionButtonLayer.svelte:390-416` arm-effect does not gate on family; only `:411` disarm-guard does, during drag.
- `FloatingActionButtonLayer.svelte:281,294,348` are the call sites of the helpers §4.5 removes.
- `fab-release-snap.spec.ts:163-168,186,216,244` thresholds coupled to the `2f-1` curve.

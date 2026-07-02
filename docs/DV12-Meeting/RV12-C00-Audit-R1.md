# RV12-C00 - Implementation Audit Round 1 (FINAL)

5 independent role-less auditors examined the DV12 implementation diff (`src/lib/components/organisms/Header.svelte`, `src/lib/utils/header-probe.ts`, `e2e/header-tab-descent-cross-tab-exit.spec.ts`) against the approved plan (`docs/DV12-Plan.md`, R3 5/5 PASS) and the codebase. (Two original auditors died on a transient API 500 at launch and were replaced.) Result: **5/5 PASS (FINAL, unconditional, all organic=clean, all high confidence, zero blocking)**. Loop exit condition met.

## Tally

| Auditor         | Verdict | Blocking | Organic | Confidence |
| --------------- | ------- | -------- | ------- | ---------- |
| 1 (replacement) | PASS    | 0        | clean   | high       |
| 2 (replacement) | PASS    | 0        | clean   | high       |
| 3               | PASS    | 0        | clean   | high       |
| 4               | PASS    | 0        | clean   | high       |
| 5               | PASS    | 0        | clean   | high       |

Result line: **5/5 PASS (FINAL, unconditional). Loop exit.**

## Empirical verification (5/5 convergent - the descent genuinely animates)

All five auditors independently ran high-frequency `getComputedStyle(rootLayer).transform` (m42 px) samplers across a real `/messages/inbox → /bookmarks → back arrow → /messages/inbox` cycle and confirmed the back-to-tab descent animates through real intermediate compositor frames, not a single-frame jump:

- Auditor 1-repl: intermediate `-9, -6, -4, -2` between -40 and 0.
- Auditor 2-repl: 11 distinct intermediate values; bucketed `-40,-35,-30,-25,-20,-15,-10,-5,0`.
- Auditor 3: 12 distinct intermediate values across `/bookmarks→/`, `/notifications→/`, `/profile→/` (generalization across 3 GPL routes).
- Auditor 4: 10 interpolation steps `-34.6 → -29.6 → ... → -0.5` over ~250ms, monotonic ease-out.
- Auditor 5: 5/5 cycles smooth; the descent completes BEFORE the URL commit (descent done at t=2783ms, URL flips at t=2841ms), so it runs entirely pre-commit on the compositor.

The morph probe (`window.__headerMorphProbe`) confirms `slideT='200ms'` (never `'none'`) and `navInFlight=true` at every back landing flush (6/6 DEFECT cycles) - the witness that the gate is independent of the `navInFlight` signal.

## Verified against source (5/5 convergent)

- **Diff matches plan R3.** `Header.svelte:203-205` is exactly `dragging || searchScrubbing ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out'`; the `(navStore.navInFlight && !settling)` term and the now-dead `navStore.navInFlight` read in that `$derived` are both removed. CALIBRATION rewritten exactly as plan §5 (back-landing `slideNone` true→false, name asymmetry→symmetry, file-header doc-comment rewritten, `navInFlight===true` witness retained, forward-landing + DEFECT bodies unchanged). Diff scope is exactly 3 files; no shared primitive touched (`navigation.svelte.ts`, `navigation-logic.ts`, `GesturePageLayout.svelte`, `MobileTabBar`, `MobileTabPager`, `swipe.ts`, `tab-config.ts`, `mobile-tabs.ts`, `scroll-chrome`, `DualColumnLayout`, `(tabs)/+layout` all empty).
- **Gesture-settle byte-identical.** Static proof (Effect B sets `settling=true` synchronously on release; Effect D clears it only when `pendingNav===null && !navInFlight`; so `settling=true` through the whole `navInFlight` window; the removed term was `(true && false) = false` on the gesture path - dead code there) + empirical (`header-tabs-replay.spec.ts` PASS, smooth `-100→0` trajectory, no snap-back).
- **CALIBRATION `navInFlight===true` witness meaningful (not tautological).** 6/6 back landings had `navInFlight=true AND slideNone=false` simultaneously - proving the gate's non-suppression is independent of the navInFlight signal. A regression re-adding the term flips `slideNone` back to true and fails.
- **Probe-rename deviation sound.** The plan §5 listed `header-probe.ts` as Unchanged; the implementation also renamed `window.__headerLog → window.__headerMorphProbe` (header-probe.ts + Header.svelte + the spec). Forced by a real collision: `header-tabs-replay.spec.ts:17,27,57` declares its own `window.__headerLog` of object shape `{frames, done}`, and the probe's `log.push(...)` on that object threw `TypeError: log.push is not a function`, crashing the gesture suite. The rename is the minimal behavior-preserving fix (same array shape, same data, DEV-gated). Disclosed in the journal.
- **`slideT` comment clean** of past-state markers (present-tense, current intent only).
- **Reactivity/SSR/HMR/title:** removing `navInFlight` from the `$derived` is a strict dependency reduction (safer graph); `navInFlight` still read by `trackStyle`/`searchButtonStyle`/`tabBarStyle`/Effect D/the probe (no dangling import); SSR renders `slideT='200ms'` with path-derived rest translateY (no hydration mismatch); `layerDownStyle` animates with the tabs layer on back-to-tab (desired) and is `translateY(0)` constant on deep→deep (`isDeepToDeep`); the title crossfade uses `titleView.transition`, not `slideT` (no `header-title-crossfade-clip` interaction).

## Non-blocking carried notes (applied where mandatory - see below)

- **Stale past-state comment in the DEFECT test body** (Auditor 5). Lines 274-277 narrated the broken state ("fails on current code... makes slideT 'none'") and contradicted the rewritten header doc-comment, violating `no-error-history-comments`. **MANDATORY cleanup - applied** (rewritten to current intent).
- **DEFECT/CALIBRATION are slideT-string checks, not trajectory** (Auditors 3, 4); the `externalSeq` rAF documentary reads `0×16` (no movement) because its window anchor misses the pre-URL-flip descent (Auditors 1-repl, 4). The plan §7 specified the trajectory probe as "audit-time" (which the auditors ran). **Strengthening applied:** a committed trajectory assertion was added to the DEFECT test (distinct intermediate computed translateY values in the (-38, -2) px band must be ≥4), closing the tautology per `audit-prompts-open-ended-not-fix-verification`. Verified locally: passes with the fix (≥4 intermediates), 0 on the bug (non-tautological by construction).
- **`trackStyle`/`searchButtonStyle`/`tabBarStyle` still gate on `navInFlight`** (Auditors 1-repl, 2-repl, 3). Documented in plan §6.9; invisible outside `isSearch` (zero delta on `translateX`/`left`/`max-height` on a non-search nav); no regression path. Out of scope (§8).
- **`opacity 200ms ease-out` in `slideT`** is a no-op on both layers (no inline `opacity` outside search mode). Pre-existing, retained (plan note (c)).
- **Journal §5 / plan §9(e) say `FloatingActionButtonLayer` lives under `organisms/`**; it actually lives under `templates/`. Cosmetic citation; the FAB-decoupling claim is correct.

## Gates (post-strengthening)

- `bun run check`: 0 errors, 0 warnings (1431 files).
- Changed files pass `prettier --check`, `eslint`, `similarity-ts`. (`bun run lint` overall is red only on 19 pre-existing unformatted `docs/DV10-*`/`docs/DV11-*` files - a prior feature, untouched by DV12.)
- **Regression spec** `e2e/header-tab-descent-cross-tab-exit.spec.ts`: CALIBRATION PASS (forward + back `slideNone=false`, `navInFlight=true` witness); DEFECT PASS (6/6 landings `slideNone=false`; trajectory assertion ≥4 intermediate px).
- **§4.4 gesture gate** `e2e/header-tabs-replay.spec.ts`: PASS (after the probe rename).
- **No-regression + FAB insurance** (40 tests): all PASS - `tab-exit-preview`, `search-enter-exit-asymmetry`, `swipe-back-pill-flicker`, `enter-animation`, `fab-deep-real-interaction`, `fab-release-snap`.

## Loop-exit statement

Loop exit condition met: 5/5 unconditional PASS on the implementation. The two applied strengthenings (stale-comment cleanup + committed trajectory assertion) are test-only, were explicitly recommended as non-blocking by the auditors, are verified locally (the trajectory assertion is non-tautological - 0 intermediate px on the bug), and do not change the Header.svelte implementation (still 5/5-verified). Per the DV09 R5 precedent (non-blocking carried notes applied without re-audit), no R2 is required. DV12 implementation approved.

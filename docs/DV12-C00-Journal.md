# DV12-C00 - Implementation Journal

Implementation of the DV12 Header tab-descent fix (plan: `docs/DV12-Plan.md`, 5/5 PASS Round 3). Mobile-only. The fix removes the `(navStore.navInFlight && !settling)` term from `Header.svelte` `slideT` so the back-to-tab tabs-layer descent animates symmetrically with the forward direction.

## Changes applied

1. **`src/lib/components/organisms/Header.svelte` `slideT` (`:193-196`)** - removed the `(navStore.navInFlight && !settling)` term:

   ```
   const slideT = $derived(
       dragging || searchScrubbing ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out'
   );
   ```

   with a comment stating the current intent (suppress only during drag / root↔search scrub; navInFlight deliberately not in the gate since it is set at every GPL exit landing and gating on it would suppress the descent; the gesture path is owned by `settling`). The now-dead `navStore.navInFlight` read in this `$derived` is removed (the field is still read by `trackStyle`/`searchButtonStyle`/`tabBarStyle` and the dev probe, so no unused-symbol issue).

2. **`e2e/header-tab-descent-cross-tab-exit.spec.ts`** - CALIBRATION rewritten to document the post-fix symmetry: the back-landing assertion `expect(backLanding.slideNone).toBe(true)` flips to `.toBe(false)`; the test name changes to "forward and back descents both keep their transition (documents the symmetry)"; the file-header doc-comment is rewritten to the branch-agnostic symmetry story. The `backLanding.navInFlight === true` assertion STAYS (witness that the gate is independent of navInFlight). Forward-landing expectations and the DEFECT test are unchanged.

3. **Probe global rename (not in the plan's §5; discovered by the §4.4 gate - see below).** `src/lib/utils/header-probe.ts`, the dev-only `$effect` in `Header.svelte`, and `e2e/header-tab-descent-cross-tab-exit.spec.ts` were renamed `window.__headerLog` → `window.__headerMorphProbe`. The dev probe I added during diagnosis collided with `e2e/header-tabs-replay.spec.ts`'s own `window.__headerLog` global (a different shape, `{ frames, done }`); the probe's `log.push(...)` on that object threw `TypeError: log.push is not a function` and crashed the gesture suite. The rename decouples the probe (array shape) from `header-tabs-replay`'s sampler (object shape).

## Gate results

- `bun run check`: 0 errors, 0 warnings (1431 files).
- `bun run lint`: the changed files pass `prettier --check`, `eslint`, and `similarity-ts`. NOTE: `bun run lint` overall is red on 19 pre-existing unformatted docs (`docs/DV10-*`, `docs/DV11-*` - a prior feature's audit records, committed unformatted, untouched by this change). This is pre-existing on `master`, not caused by DV12.
- **Regression spec** `e2e/header-tab-descent-cross-tab-exit.spec.ts`:
  - CALIBRATION: PASS. Back-landing flush `slideNone=false, navInFlight=true`; forward-landing `slideNone=false`. Symmetry documented.
  - DEFECT (6 cycles): PASS. Every back landing `slideNone=false` (the gate is never suppressed at a tab-root landing).
- **§4.4 gesture gate** `e2e/header-tabs-replay.spec.ts`: PASS (after the probe rename; the collision above was the only blocker).
- **No-regression + FAB insurance suite** (40 tests): all PASS - `tab-exit-preview` (6), `search-enter-exit-asymmetry` (3), `swipe-back-pill-flicker` (2), `enter-animation`, `fab-deep-real-interaction` (16), `fab-release-snap` (3). The FAB specs confirm the FAB is decoupled (it reads `navInFlight` directly at `FloatingActionButtonLayer.svelte:362`, never via Header's `slideT`).

## Carried-to-implementation notes (from `DV12-Audit-R3.md`) disposition

- (a) CALIBRATION rewrite is the whole name + file-header doc-comment, not a parenthetical - applied (the doc-comment and the test name were both rewritten to the symmetry story).
- (b) `/search → /messages/inbox` same-flush `searchScrub` completeness case - safe by Svelte 5 same-flush derived recomposition; no code action, documented in the plan §6.5 gist.
- (c) `opacity 200ms` no-op in `slideT` - pre-existing, retained.
- (d) `trackStyle`/`searchButtonStyle`/`tabBarStyle` keep their own `navInFlight` reads - unchanged (out of scope, invisible outside `isSearch`).
- (e) `FloatingActionButtonLayer` lives under `templates/` - cosmetic.
- (f) DEFECT spec is a slideT-string check; the separate audit-time trajectory probe gate in the plan covers trajectory.

## Deviation from the plan

The plan §5 listed `Header.svelte` and `e2e/header-tab-descent-cross-tab-exit.spec.ts` as Modified, and `src/lib/utils/header-probe.ts` as a retained diagnostic (unchanged). Implementation also touched `header-probe.ts` (and the probe global in `Header.svelte` and the spec) for the `__headerLog` → `__headerMorphProbe` rename. This was forced by the §4.4 gate catching the probe/sampler global collision; the rename is the minimal fix and does not change the probe's data or the plan's mechanism. The RV audit reviews the actual diff including this rename.

## RV audit (RV12-C00-Audit-R1) - 5/5 PASS (FINAL, unconditional). Loop exit.

5 role-less auditors examined the implementation diff against the plan + codebase (2 originals died on a transient API 500 at launch and were replaced). Result: **5/5 PASS, zero blocking, all high confidence.** Full detail: `docs/DV12-Meeting/RV12-C00-Audit-R1.md`.

All 5 independently ran high-frequency `getComputedStyle(rootLayer).transform` samplers and confirmed the back-to-tab descent animates through real intermediate compositor frames (10-12 distinct values -40→0 across `/bookmarks`, `/notifications`, `/profile`), not a single-frame jump. Auditor 5 further showed the descent completes BEFORE the URL commit (runs entirely pre-commit on the compositor). The morph probe witnesses `slideT='200ms'` (never `'none'`) + `navInFlight=true` at 6/6 back landings. Gesture-settle byte-identity proven statically (Effect B+D hold `settling=true` through the `navInFlight` window, so the removed term was dead code on the gesture path) and empirically (`header-tabs-replay` PASS, smooth trajectory). Diff matches plan R3 exactly; probe-rename deviation sound; `slideT` comment clean of past-state markers.

### Strengthenings applied post-round (test-only, auditor-recommended)

- **Stale past-state comment in the DEFECT body** (Auditor 5, mandatory `no-history-comments` cleanup): rewritten to current intent.
- **Committed trajectory assertion** (Auditors 3, 4 - close the slideT-string tautology per `audit-prompts-open-ended`): the DEFECT test now also asserts ≥4 distinct intermediate computed translateY values in the (-38, -2) px band across the sampled frames. Non-tautological by construction (0 intermediate px on the bug, ≥4 with the fix). Verified: the strengthened DEFECT passes; `bun run check` 0 errors.

Gates post-strengthening: `bun run check` 0/0; changed files prettier/eslint/similarity clean; regression spec CALIBRATION + DEFECT pass; §4.4 gesture gate passes; no-regression + FAB insurance 40/40 pass. The strengthenings do not change `Header.svelte` (still 5/5-verified); per the DV09 R5 precedent, no R2 required. **DV12 implementation approved.**

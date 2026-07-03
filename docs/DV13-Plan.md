# DV13 - Search-back hamburger-arrow flash

**Status:** 5/5 PASS (FINAL, unconditional, after 3 audit rounds). Approved for implementation. The fix `const iconProgress = $derived((isSearch || searchScrubbing) ? 0 : 1 - morph);` was unanimously endorsed across all three rounds; the rounds converged on plan-text accuracy (gesture mechanism, comment hygiene, mask rationale). Round-1 audit: `docs/DV13-Meeting/DV13-Audit-R1.md`. Round-2: `docs/DV13-Meeting/DV13-Audit-R2.md`. Round-3 (FINAL): `docs/DV13-Meeting/DV13-Audit-R3.md`.
**Scope:** A single derived value in `Header.svelte` (`iconProgress`). Mobile and desktop share the same Header markup; the defect is viewport-independent.
**Diagnosis basis:** `e2e/search-back-hamburger-flash.spec.ts` (committed at `8e7a76e`), which reproduces the flash empirically with a per-frame sampler of the `BurgerArrowIcon` mask-group rotation. The per-flush state-machine trace was captured with a temporary dev probe (since removed); its findings are cited below as the empirical basis for the root cause.

## 1. Goal

Eliminate the intermittent hamburger-to-back-arrow flash on the `/search` -> `/` browser-back navigation (and, by the same mechanism, `/search` -> any tab-root back). The user report: enter `/`, tap the search button, press the browser back button to return to `/`; intermittently the hamburger icon plays its arrow morph for a few milliseconds then snaps back to a hamburger.

The fix must remove the flash on every back (not just the first) without disturbing the root↔deep vertical morph, the search enter/exit horizontal slide, the gesture back-swipe, or the deep-title crossfade state machine.

## 2. Defect analysis (empirical)

The `BurgerArrowIcon` atom renders one `<svg><defs><mask id="burger-arrow"><g style="...rotate(Xdeg)...">` whose inline `rotate(Xdeg)` equals `180 * progress` (`progress` is the atom's `p`, clamped 0..1). Sampling that group's rotation per animation frame is a direct read-out of `iconProgress`.

`e2e/search-back-hamburger-flash.spec.ts` drives `/` -> `/search` -> `page.goBack()` -> `/` and samples. Results on current `master`:

- Single back after a warm-up: `maxTargetOnRoot = 180deg` (full arrow on the first scrub frame).
- Five-iteration loop from a fresh load: per-iteration `maxTargetOnRoot = 0.0, 180, 180, 180, 180`. Iteration 0 does not flash; iterations 1+ always flash.
- Forward direction `/` -> `/search`: `maxTargetOverall = 0.0deg` (no flash).

The defect is real, reproducible, and asymmetric (only the search -> root direction flashes).

## 3. Root cause

`src/lib/components/organisms/Header.svelte:192`:

```ts
const iconProgress = $derived(isSearch ? 0 : 1 - morph);
```

The shared `morph` signal serves two unrelated animations:

- The **root↔deep vertical morph** (the icon's actual domain): `morph = 1` on a tab-root route, `0` on a deep page. `iconProgress = 1 - morph` correctly turns the hamburger into a back arrow on a deep page.
- The **root↔search horizontal tap scrub**: `startSearchScrub(from, to)` (lines 404-427) animates `morph` between its two rest values over ~200ms so the piecewise search consumers (the track translate, the scope-tab bar max-height, the search button `left`) sequence slide-then-expand on enter and collapse-then-slide on exit. This scrub is consumed by `morph` branch 1b at lines 150-153.

On a `/search` -> `/` browser back, Effect E (lines 378-402) detects the `currentHasTabs` flip (false -> true) AND the `isSearch` flip (true -> false) and calls `startSearchScrub(0, 1)`. The scrub drives `morph` from 0 to 1. At scrub progress 0, `morph = 0`, so `iconProgress = 1 - 0 = 1` (full back arrow). As the scrub advances, `morph` rises to 1 and `iconProgress` decays 1 -> 0. The icon target jumps to the arrow for the first scrub frame and returns to the hamburger over ~200ms: the flash.

The freeze `isSearch ? 0` was intended to keep the icon a hamburger during a search transition (the comment at lines 190-191 says so). It fails because it keys on the DESTINATION mode: on the back, `isSearch` flips false in the same flush the scrub starts, so the freeze lifts exactly when the scrub drives `morph` through 0.

### Why the forward direction does not flash (asymmetry)

On `/` -> `/search`, `isSearch` flips true in the same flush the scrub starts, so the `isSearch ? 0` short-circuit forces `iconProgress = 0` before the scrub can drive it. The forward direction is frozen by accident; the back direction is exposed.

### Why the gesture back-swipe from `/search` does not flash

A gesture back-swipe does not enter `startSearchScrub`. During the drag, Effect E's `if (untrack(() => dragging)) return` guard (line 398) blocks it. At release the gesture's commit settle (armed by Effect B, `settling = true`, `settleAwaitTitle = true`, `pendingNav = '/'`) takes over: `morph` runs through branch 2 (`isSettleMode`, lines 156-181), driven by `settleProgress` 0 -> 1 to its rest value of 1. The settle then shields the route change from Effect E by an INTER-flush gap: at the route-change flush `currentPath` flips to `/` but `navInFlight` is still `true` (SvelteKit's `afterNavigate` has not fired yet); Effect D ends the settle only when `navInFlight` clears (it tracks `navInFlight`/`pendingNav` outside untrack), so at the route-change flush `settling` is still `true`, and Effect E re-runs (its tracked deps `currentHasTabs`/`isSearch` changed with the path), reads `settling === true` via untrack at line 399, and returns early. At the NEXT flush `navInFlight` clears, Effect D runs `endSettle()`, but Effect E does NOT re-run (its tracked deps have not changed again), so `startSearchScrub` never fires. By the time the settle ends, `morph` is already 1 and `currentPath` is `/`, so `iconProgress = 1 - 1 = 0`.

The defect is specific to the tap / popstate path where no gesture precedes the back, so no commit settle shields the route change, `settling` is false at the route-change flush, and Effect E fires `startSearchScrub`.

**Empirically confirmed (Round 1).** A CDP touch back-swipe `/search` -> `/` against DV12's committed `window.__headerMorphProbe` shows `min morph on / after landing = 1.000`: the trajectory is `morph` 0.05 -> 0.57 (drag, branch 1) -> settle `sp` 0.57 -> 1.00 (branch 2, `settling = true`, `pendingNav = '/'`) -> land on `/` at `morph = 1.00`, `navInFlight = true`, `settling = true` -> next flush `navInFlight = false`, `settling = false`. `morph` never dips after landing; there is no `rootLayerStyle` / `searchProgress` jump.

## 4. The intermittency (why iteration 0 is clean)

Effect E's guard at line 399:

```ts
if (untrack(() => settling)) return; // a settle is in flight
```

The five-iteration e2e signature `0.0, 180, 180, 180, 180` shows iteration 0 does not flash while iterations 1+ always do. The difference is whether `settling === true` at the back moment: when it is, Effect E returns early, `startSearchScrub` never fires, `morph` takes the settle branch (branch 2 / `isSettleMode`, lines 156-181) which for a tabs -> tabs transition resolves to `morph = 1`, and `iconProgress = 0` for the whole back (no flash, by accident). When `settling === false`, the scrub fires and the flash plays.

**Empirically confirmed (Round 1).** A probe of DV12's `window.__headerMorphProbe` across the five-iteration loop shows iteration 0 has `settling = true` at the back moment (a commit settle, `settleProgress` 0 -> 1, `pendingNav = '/'`), while iterations 1+ have `settling = false` (the scrub fires, `morph` scrubs 0 -> ~0.78). The settle on iteration 0 is a COMMIT settle (`settleAwaitTitle = true`, `pendingNav = '/'`) lingering from the initial-load / first-forward-nav sequencing, NOT a deep-title idle-branch settle: `/` has `title === ''` (no `headerTitle`, `/` absent from `deep-header-config.ts`), so Effect C's idle branch takes `else if (!newTitle && !isDeep)` and arms no title settle. The exact origin of the lingering commit settle on iteration 0 is the initial-load / first-forward-nav ordering; it is subtle and not load-bearing for the fix.

The intermittency is a SYMPTOM of the same coupling, not a separate bug. Fixing `iconProgress` removes the flash unconditionally; the masking settle becomes irrelevant (there is nothing to mask).

## 5. Architecture context (verified inventory)

- `src/lib/components/organisms/Header.svelte:140-188` - the `morph` derived. Branch 1 (`dragging`, line 143), branch 1b (`searchScrubbing`, lines 150-153), branch 2 (`isSettleMode`, lines 156-181), branch 3 (rest, line 184).
- `src/lib/components/organisms/Header.svelte:192` - `iconProgress = $derived(isSearch ? 0 : 1 - morph)`. The defect.
- `src/lib/components/organisms/Header.svelte:203-205` - `slideT` (DV12 already gates this on `dragging || searchScrubbing`, suppressing the layer CSS transition during a scrub). The icon freeze needs the same `searchScrubbing` discriminant `slideT` already uses.
- `src/lib/components/organisms/Header.svelte:378-402` - Effect E, the root↔search scrub trigger. Guards: `curTabs === prevTabs` (394), `curIsSearch === prevS` (395), `!browser` (396), `curTitle !== prevT` (397), `dragging` (398), `settling` (399), `lastGestureMorph` (400). Calls `startSearchScrub` at 401.
- `src/lib/components/organisms/Header.svelte:404-427` - `startSearchScrub(from, to)`. Sets `searchScrubbing = true`, `searchScrubProgress = 0`, animates `searchScrubProgress` 0 -> 1 over `TITLE_CROSSFADE_MS` (200ms) via rAF, clears `searchScrubbing` at completion.
- `src/lib/components/organisms/Header.svelte:769` - `<BurgerArrowIcon progress={iconProgress} {dragging} />`, the sole consumer of `iconProgress`.
- `src/lib/components/atoms/BurgerArrowIcon.svelte:36,72-83` - `p = clamp(progress, 0, 1)`; the mask group `groupStyle` is `rotate(${180 * p}deg)`. Confirms the rotation read-out is `180 * iconProgress`.
- `src/lib/utils/gesture-constants.ts:8` - `TITLE_CROSSFADE_MS = 200`, the scrub duration.
- `src/lib/utils/header-probe.ts` + the `__headerMorphProbe` write in `Header.svelte` (lines ~548-580) - the DV12 dev-only diagnostic sink. DV13 does NOT touch it; it is an unrelated committed dev probe for a different defect.

### Consumers of `morph` (impact surface of any change)

`morph` is read by: `iconProgress` (192, the defect), `rootLayerStyle` (the tab layer vertical position), `layerDownStyle` (the deep-title layer vertical position), `searchProgress` / `tabProgress` (the horizontal search consumers), and the `__headerMorphProbe` snapshot. The fix changes ONLY `iconProgress`'s expression; every other consumer of `morph` is untouched, so the tab layer slide, the title crossfade, and the search track / scope-tab / button motion are all unchanged.

## 6. Design

### 6.1 The fix

Change the `iconProgress` freeze discriminant from the destination mode to "a search transition is in flight":

```ts
// Freeze the icon morph during a search transition. The icon's morph is a
// root<->deep animation; `morph` is also driven as horizontal scrub progress
// (branch 1b) on root<->search taps, where the icon must stay a hamburger at
// both endpoints. Freeze on `isSearch` (search-mode rest) AND `searchScrubbing`
// (the tap scrub in flight). Outer parens mirror slideT's discriminant style.
const iconProgress = $derived(isSearch || searchScrubbing ? 0 : 1 - morph);
```

Both endpoints of a root↔search transition have the icon at the hamburger: on a tab root, `morph = 1` -> `iconProgress = 0`; in search mode, `isSearch` -> `0`. Freezing at the literal `0` during the scrub is therefore exactly correct for both the enter and the exit direction.

### 6.2 Why this is the root-cause fix, not a band-aid

The root cause is the coupling of `iconProgress` to the shared `morph` while `morph` is also driven by the horizontal search scrub. The icon's morph is meaningful only for the root↔deep vertical animation. The correct semantic for the freeze is "the icon is inert whenever a search transition is in flight", which is precisely `isSearch || searchScrubbing`:

- `isSearch` covers the search-mode rest state (forward direction, already correct).
- `searchScrubbing` covers the scrub transition itself (the back direction, the defect).

`slideT` (lines 203-205) already uses the `dragging || searchScrubbing` discriminant for the same reason (suppress the layer CSS transition while `morph` is driven 1:1 by the scrub). The fix aligns `iconProgress`'s freeze with the same in-flight signal the rest of the search-transition machinery uses.

### 6.3 Alternatives considered (rejected, documented for auditors)

- **Freeze on `morph`-through-zero detection** (`iconProgress = morph === 0 && !isSearch ? ... : ...`). Rejected: branch 1b legitimately drives `morph` through 0 during the back scrub; detecting "morph is 0" would also fire on a resting deep page (where the arrow IS correct). The freeze must be keyed on the search-transition cause, not on a `morph` value.
- **Remove the icon from `morph` entirely; drive it from a separate `deepMorph` signal.** Rejected as over-broad for this defect. `iconProgress = 1 - morph` is correct for every non-search transition (root↔deep, gesture settle, click). Only the search scrub mis-feeds it. The freeze is the minimal change that restores the correct semantic. (Auditors may over-rule if they find a second mis-feeding path.)
- **Freeze on `searchScrubbing` only (drop `isSearch`).** Rejected: at search-mode REST (`searchScrubbing === false`, `isSearch === true`) `morph` is 0 (search has no tabs) so `1 - morph` would be 1 (arrow). The `isSearch` term is load-bearing at rest. Both terms are required.

## 7. Files

**Modified:**

- `src/lib/components/organisms/Header.svelte` - ONE expression change at line 192: `isSearch ? 0 : 1 - morph` -> `isSearch || searchScrubbing ? 0 : 1 - morph`, plus the comment above it expanded to state the scrub-term rationale. No other line changes.

**Unchanged (verification targets):** every other consumer of `morph` (`rootLayerStyle`, `layerDownStyle`, `searchProgress`, `tabProgress`, the `__headerMorphProbe` snapshot), Effect E, `startSearchScrub`, the title state machine (Effects B/C/D), `slideT`, `BurgerArrowIcon.svelte`, `gesture-constants.ts`, `header-mode.ts`, `deep-header-config.ts`, `mobile-pager.svelte.ts`, `navigation.svelte.ts`, `scroll-chrome.svelte.ts`, `header-probe.ts`. The diff is one expression + its comment.

## 8. Edge cases & risks

1. **Forward `/` -> `/search` tap.** `isSearch` flips true in the same flush; `iconProgress = 0` throughout. Unchanged by the fix (the `searchScrubbing` term is redundant here but harmless). Covered by the ASYMMETRY e2e spec.
2. **Back `/search` -> `/` browser back.** The defect path. `searchScrubbing` is true for the scrub's 200ms; `iconProgress = 0` throughout; no flash. Covered by the DEFECT e2e spec.
3. **Back `/search` -> `/activity` (or `/messages/inbox`).** Effect E fires on any `currentHasTabs` flip paired with an `isSearch` flip; the scrub runs identically. The fix covers all tab-root destinations. (The e2e suite covers `/`; the audit verifies the path predicate is destination-agnostic.)
4. **Gesture back-swipe from `/search`.** Does not enter `startSearchScrub`. The gesture's commit settle shields the route change by an inter-flush gap: `navInFlight` clears in a later flush than the path change, so `settling` is still true at the route-change flush and Effect E returns early at the `if (settling) return` guard; by the next flush Effect E does not re-run. `morph` is driven to 1 by the settle (branch 2); `iconProgress = 0` throughout. Empirically confirmed (`min morph on / after landing = 1.000` via `__headerMorphProbe`). The fix does not touch this path.
5. **`/search` <-> deep (e.g. `/profile`).** `currentHasTabs` does not flip (both false); Effect E's `curTabs === prevTabs` guard returns early; no scrub. `iconProgress` follows `morph` as before. Unchanged.
6. **Root↔deep (the icon's actual domain).** Neither `isSearch` nor `searchScrubbing`; `iconProgress = 1 - morph`. Unchanged.
7. **A scrub interrupted mid-flight by a new navigation.** `startSearchScrub` cancels the prior rAF and re-arms; `searchScrubbing` stays true through the new scrub. `iconProgress` stays 0. No partial-arrow leak.
8. **SSR.** `searchScrubbing` is `false` on the server (the rAF never runs); `isSearch` is path-derived. `iconProgress` resolves to the same SSR value as before for every route. No SSR / hydration shift.
9. **The intermittency mask (Effect E `if (settling) return`).** Untouched. Post-fix it no longer matters: even when the scrub fires, `iconProgress` is frozen. The five-iteration e2e loop confirms every iteration stays at 0.
10. **The DV12 `__headerMorphProbe`.** A committed dev-only sink for a different defect. DV13 does not read or write it. The fix does not alter the snapshot's `morph` field (the snapshot reads `morph`, not `iconProgress`).

## 9. Testing plan

- **Existing e2e (`e2e/search-back-hamburger-flash.spec.ts`, committed at `8e7a76e`):**
  - CALIBRATION (pass): harness reaches `/search` and returns to `/`; sampler live.
  - DEFECT (currently FAILS with `maxTargetOnRoot = 180`): after a warm-up back, the instrumented back must keep `maxTargetOnRoot <= 15`. Post-fix: `0`.
  - INTERMITTENCY (currently FAILS 4/5): the five-iteration loop from a fresh load must keep EVERY iteration `<= 15`. Post-fix: all five `0`.
  - ASYMMETRY (pass): forward `/` -> `/search` `maxTargetOverall <= 15`. Post-fix: unchanged `0`.
- **Unit.** None added. `iconProgress` is a `$derived` inside a Svelte component (not runes-free), so it is not unit-testable under `bun test` (memory `bun-test-no-runes-loader`). The e2e sampler is the test surface, matching the `header-title-replay` and `search-enter-exit-asymmetry` pattern.
- **Regression sweep.** `bun run check`, `bun test src/`, `bun run test:e2e e2e/search-back-hamburger-flash.spec.ts`, plus the header / search e2e neighbours (`header-title-replay`, `search-enter-exit-asymmetry`, `header-hide-on-scroll`, `header-tabs-replay`) to confirm no collateral.
- **Audit gates.** `git diff -- src/lib/components/organisms/Header.svelte` shows ONLY the `iconProgress` expression change and its comment. Every other file in `src/` has zero DV13 diff. No new tokens enter any shared primitive (the change is to an already-Header-local derived). The diff is provably single-target: `grep -n iconProgress src/` returns exactly two hits, the declaration (`:192`) and the sole consumer `<BurgerArrowIcon progress={iconProgress}>` (`:769`); no other file references `iconProgress`.
- **Audit loop.** 5 agents, cycle until 5/5 unconditional PASS (DV04 / DV09 pattern). `docs/DV13-Meeting/DV13-Audit-R[N].md` + `docs/DV13-Meeting/DV13-Plan-Journal.md` per round.

## 10. Out of scope

- The DV12 `__headerMorphProbe` sink and the tabs-layer jump it diagnoses (a different defect, separate cycle).
- The Effect E `if (settling) return` intermittency mask (line 399). The mask gates `startSearchScrub`, which drives `morph` branch 1b consumed by `rootLayerStyle`, `layerDownStyle`, `searchProgress`, `tabProgress`, `trackStyle`, `searchButtonStyle`, and `tabBarStyle` (the horizontal search-track / scope-tab / search-button motion). Post-DV13 it no longer affects `iconProgress` (which the fix freezes unconditionally), but it STILL load-bears for those non-icon consumers during a settle: removing it would let the scrub fire and visibly defect them. Removing the mask is therefore a behavior change to the search-track animation, not a cleanup, and is out of scope for DV13's icon-only fix. It is left in place to keep the DV13 diff atomic.
- Decoupling `iconProgress` from `morph` into a separate `deepMorph` signal (rejected at §6.3 as over-broad).
- The desktop Header. Effect E and `startSearchScrub` are viewport-agnostic and DO arm on desktop, but `BurgerArrowIcon` (the sole `iconProgress` consumer) lives inside the `md:hidden` mobile block (`Header.svelte:758`), so the fix is a desktop no-op. The fix is a strict superset of correct behavior on mobile.

## 11. UNVERIFIED items for Round 1

- **No collateral on the deep-title crossfade.** The fix changes only `iconProgress`; the title state machine is untouched. Auditor to confirm the `header-title-replay` e2e still passes (it is a sibling derivation over the same `morph`).

## 12. Verified items (empirical + static)

- **Gesture back-swipe from `/search` does not flash and does not enter `startSearchScrub`.** Verified via `__headerMorphProbe`: `min morph on / after landing = 1.000`. The gesture's commit settle shields the route change by an inter-flush gap (`navInFlight` clears in a later flush than the path change, so `settling` holds through the route-change flush and Effect E returns early; Effect D ends the settle next flush, but Effect E does not re-run). `morph` is driven to 1 by branch 2.
- **The intermittency mask is `settling`.** Verified via `__headerMorphProbe`: iteration 0 `settling = true` (a lingering commit settle), iterations 1+ `settling = false` (the scrub fires). The fix makes the mask moot for `iconProgress`.
- **`/search` -> `/activity` and `/search` -> `/messages/inbox` are fixed identically (statically verified).** Effect E fires on any `currentHasTabs` flip paired with an `isSearch` flip (guards at `:394-395`), destination-agnostic; all three tab roots (`/`, `/activity`, `/messages/inbox`) have `currentHasTabs === true` and `title === ''` (no `headerTitle` load, none in `deep-header-config.ts`), so the `curTitle !== prevT` guard at `:397` passes through identically. Parametrized e2e coverage (`/activity`, `/messages/inbox`) is added at implementation as a belt-and-suspenders guard, not because the static proof is in doubt.

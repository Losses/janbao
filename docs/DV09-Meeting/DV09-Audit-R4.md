# DV09 - Audit Round 4

5 independent role-less auditors examined `docs/DV09-Plan.md` (Round-4 revision: hide-on-scroll via `translateY`, echoing the Header) against the codebase at `master` (`0a03874`). The Round-4 revision supersedes the R3 "always visible" lock and adds §4.12 (eight sub-sections) on top of the R3-approved design. All other R3 design (AppShell placement, module-singleton track store, foregroundFraction scale, A/B/C taxonomy) is unchanged and is NOT re-litigated.

Workflow: the loop runs one cycle per round; auditors are dispatched in parallel; the cycle passes only on 5/5 unconditional PASS. This cycle returned **3/5 PASS, 2/5 FAIL** (not unanimous) and is therefore NOT a loop exit. All 5 auditors converge on the same defect and the same fix; the FAIL verdicts treat it as blocking, the PASS verdicts treat it as non-blocking but agree the fix is strictly cleaner and does not violate the R3 organic-clean gate. The owner is the tiebreaker; the revision mandate below switches to the path-2 fix.

## Tally

| Auditor | Verdict | Blocking | Concerns                                                                                                                              | Organic           | Confidence |
| ------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------- |
| 1       | PASS    | 0        | non-blocking path-1 notes                                                                                                             | clean             | high       |
| 2       | PASS    | 0        | non-blocking path-1 perf footgun                                                                                                      | clean             | high       |
| 3       | FAIL    | 1 (B1)   | path-1 misreads R3 gate; per-frame reflow or duplicate observer; under path 1 the §9R4 timing item is itself evidence path 1 is wrong | has-special-cases | high       |
| 4       | FAIL    | 1 (B1)   | path-1 non-reactive per-frame forced-reflow antipattern; Header.svelte:570 itself uses no per-frame getComputedStyle                  | has-special-cases | high       |
| 5       | PASS    | 0        | path-1 cost small but path 2 strictly cleaner; not a token-gate violation                                                             | clean             | high       |

Result line: **3/5 PASS, 2/5 FAIL → revised (path 2).**

## Verified R4 mechanisms (all 5 confirmed)

Every auditor independently verified the R4 mechanism is structurally sound:

- **`translateY` getter is reactive.** `scroll-chrome.svelte.ts:215-217` (`get translateY() { return translateY; }`) reads the closure `let translateY = $state(0)` at `scroll-chrome.svelte.ts:61`. A `$derived` reading `scrollChrome.translateY` re-runs on every write. This is the same reactivity pattern R3 endorsed for `getActiveGestureTrack()` and the production precedent (`Header.svelte:57,62`, `MobileTabBar.svelte:49`).
- **Derivation math is sound.** `scroll-chrome.svelte.ts:108-112` clamps `translateY` to `[-headerHeight, 0]`. `headerHeight` is seeded non-zero at `scroll-chrome.svelte.ts:65` (`let headerHeight = $state(56)`), so `-translateY / headerHeight ∈ [0, 1]` and division is defined. `p = 0` at Header-rest, `p = 1` at Header-hidden.
- **Composed single transform.** The FAB atom binds one `style:transform = "scale(${s}) translateY(${y}px)"` string, mirroring `Header.svelte:570`'s single `style:transform="translateY({translateY}px)"`. CSS allows only one `transform` per rule; the composition is mandatory and correct.
- **`scale` and `translateY` are orthogonal.** Different matrix dimensions; no precedence rule, no conflict. The route-transition `scale` driver (§4.6, unchanged from R3) and the scroll-driven `translateY` (§4.12) never contend for the same axis.
- **`scroll-chrome` is active on the list routes.** `(tabs)/+layout.svelte:108` reads `window.scrollY`; the list routes (`/`, `/activity`, `/messages/inbox`) are NOT under `fixed-viewport`, so the default window scroll listener at `scroll-chrome.svelte.ts:145-146` fires and drives `translateY`. The FAB's `$derived` tracks.
- **No bottom chrome.** `MobileTabBar.svelte:79` is a `<nav>` row of pills rendered INSIDE the Header at `Header.svelte:620`. It is NOT a bottom bar (no `position: fixed`, no `bottom-0`, no own z-index). `rg "fixed.*bottom|bottom-nav"` over `src` returns zero navigation-chrome hits. The FAB slides off the viewport bottom edge into empty space; no sibling bottom chrome to reconcile z-index with.
- **No R3 regression.** AppShell placement, module-singleton track store, foregroundFraction scale, A/B/C taxonomy, cross-tab chip-exit (`pendingNav !== null || navInFlight`), pointer-events gating (`s < 0.01`), and the §7 audit gates for `swipe.ts`, `tab-config.ts`, `navigation*.ts`, `Header.svelte`, `MobileTabBar.svelte`, `(tabs)/+layout.svelte`, `DualColumnLayout.svelte`, `+layout.server.ts` are all intact.

## Convergent blocker: path 1 vs path 2 (the `headerHeight` source)

The R4 revision sources the Header height for the `p = clamp(-scrollChrome.translateY / headerHeight, 0, 1)` derivation by reading the `--header-height` CSS custom property via `getComputedStyle(document.documentElement).getPropertyValue('--header-height')` (Header.svelte:535 writes it inside the same ResizeObserver that calls `setHeaderHeight`). This is **path 1**. The alternative, **path 2**, is to add a one-line `get headerHeight() { return headerHeight; }` getter to the object returned by `getScrollChromeStore()` in `scroll-chrome.svelte.ts`, mirroring the existing `translateY` getter at lines 215-217, reading the already-present closure `$state(56)` at line 65.

All 5 auditors agree path 2 is correct and path 1 is wrong, on three independent grounds:

1. **CSS custom properties are NOT Svelte-reactive.** `getComputedStyle(...).getPropertyValue('--header-height')` is an untracked read. The FAB's `$derived` re-runs ONLY because `scrollChrome.translateY` is also tracked; the Header height is read as a side value each re-run. This is a correct-by-accident read, not a reactive contract.
2. **PERF: forced reflow per scroll frame if read inline.** If the implementer reads `getComputedStyle(document.documentElement)` inside the per-scroll-frame `$derived`, it forces a style recalc + layout sync on `<html>` every scroll frame. This is a scroll-jank antipattern. The plan's "cached, re-read only when needed" wording does not specify the invalidation signal; the only sound one is a `ResizeObserver` on `headerEl`, which `Header.svelte:529-540` ALREADY runs (calling `setHeaderHeight` AND writing `--header-height` in the same callback). Path 1 therefore forces a redundant duplicate observer OR accepts stale `headerHeight` across a Header resize. Auditor 4 notes `Header.svelte:570` itself uses NO per-frame `getComputedStyle`; the FAB path 1 would be the ONLY call in the scroll hot path.
3. **The justification misreads the R3 organic-clean gate.** Per `DV09-Audit-R3.md` "Organic integration - CLEAN" and `DV09-Plan-Journal.md` Round 3, the R3 gate is **"no FAB-named tokens (`fab` / `post` / `messages` / `discussions`) enter shared primitives"**, NOT "zero diff to `scroll-chrome.svelte.ts`". `headerHeight` is a GENERAL scroll-chrome concept; the store's own docstring at `scroll-chrome.svelte.ts:9-11` describes it as "the current viewport's header height" and explicitly attributes it to Header's ResizeObserver. Exposing it as a getter adds NO FAB token. This is the same honest form R3 already endorsed for the `active-gesture-track` store (a general gesture-surface store, named for the concept not for the FAB, with the FAB as its sole current consumer). The plan's deference to the literal "`git diff -- scroll-chrome.svelte.ts` empty" gate is over-conservative.

**The path-2 fix.** Add one line to the object returned by `getScrollChromeStore()` at `scroll-chrome.svelte.ts:210-232`:

```
get headerHeight() {
    return headerHeight;
},
```

mirroring the existing `translateY` getter at `:215-217`. The FAB derivation becomes `p = clamp(-scrollChrome.translateY / scrollChrome.headerHeight, 0, 1)`. Fully reactive (closure `$state(56)` at `:65` seeded non-zero, division defined, no NaN edge). Zero `getComputedStyle`. Zero per-frame reflow. Zero duplicate observer. Zero SSR/first-paint edge (the getter reads the seeded `$state(56)` until Header's ResizeObserver fires `setHeaderHeight` with the real value).

Path 2 satisfies the actual R3 gate (no FAB tokens; the getter is a general field paralleling `translateY` / `hidden` / `scrolling` / `override`). The §7 audit gate for `scroll-chrome.svelte.ts` is revised from "diff empty" to "diff shows ONLY the `get headerHeight()` getter, no FAB tokens".

## Even PASSes agree path 2 is cleaner

The 3 PASS verdicts did not block on path 1 because they judged the R4 mechanism functionally correct as specified and the path-1 perf cost manageable with the implementer's caching discipline. They nonetheless explicitly stated path 2 would be strictly cleaner and does NOT actually violate the organic-clean gate:

- **Auditor 1 (PASS, high, clean):** "path 2 would be cleaner and does not actually violate the organic gate (plan's deference to literal R3 gate is over-conservative)." Non-blocking: path-1 "cached" underspecified (should be a `browser`-guarded `$effect` writing local `$state`, not inline in the per-frame derived); SSR `getComputedStyle` must be `browser`-guarded.
- **Auditor 2 (PASS, high, clean):** "Path-2 framing overstated: R3 gate is 'no FAB tokens' not byte-identity; headerHeight getter would NOT violate it." Production precedent for path-1 read exists (`DualColumnLayout.svelte:172`, `MobileTabPager.svelte:403/432`) so path 1 is acceptable with a cache note; but path 2 is strictly cleaner.
- **Auditor 5 (PASS, high, clean):** "Path-1 getComputedStyle cost small (single root element, rAF-throttled, cheaper than GPL's per-frame DOMMatrix at `GesturePageLayout.svelte:577`) but path 2 strictly cleaner and NOT a token-gate violation; plan's 'gate regression' framing overstated."

The 2 FAIL verdicts (auditors 3, 4) treated path 1 as a HIGH blocker for the per-frame reflow antipattern and the misread-gate justification. They converge with the 3 PASSes on the fix: switch to path 2.

## §9R4 carried items

- **`--header-height` reliably non-empty at first scroll.** [§4.12.2 path 1] **DROPPED under path 2.** The path-2 getter reads the seeded `$state(56)` (`scroll-chrome.svelte.ts:65`) until Header's ResizeObserver fires `setHeaderHeight` with the real value, so the `p` computation is defined from first paint. There is no `getComputedStyle` empty-string → NaN edge. Auditor 3 notes the §9R4 timing item existing AT ALL is itself evidence path 1 was wrong (it is path-1-specific).
- **Safe-area inset at the bottom edge.** [§4.12.6] The repo has zero `env(safe-area-inset-bottom)` usage today (verified: `rg "safe-area"` over `src` returns nothing). The resting `bottom: 1rem` and `bottomClearance = 1rem` may clip the iOS home indicator. ACCEPTABLE-DEFERRAL. Designer confirms whether `bottom` should be `calc(1rem + env(safe-area-inset-bottom))`; if so, both the resting offset and the slide distance update together.
- **Re-confirm no other bottom chrome.** [§4.12.6] Source shows `MobileTabBar` is the top-Header pill row; no bottom bar exists today. Auditor re-confirms no future bottom nav or OS-level PWA bar the FAB would slide through. ACCEPTABLE-DEFERRAL.

## Non-blocking notes (carried to implementation, NOT re-audited)

- **`p >= 0.99` pointer-events magic number (auditors 3, 5).** The `pointer-events: none` gate at `p >= 0.99` is one epsilon off the `hidden` flag at `translateY <= -headerHeight` (`scroll-chrome.svelte.ts:115`). Auditor 3 notes the magic number; auditor 5 calls it a minor one-epsilon disagreement. Acceptable; the `0.99` threshold fires marginally before the FAB is fully off-screen so a tap cannot land on a partially-visible button. Could be tied to the clip math explicitly in implementation.
- **Header transition asymmetry at scroll-stop (auditor 1).** Header's transition into rest on scroll-stop may differ from the FAB's `transition: none` at rest; the FAB holds the last `p` until the next scroll. Acceptable; matches the inherited-Header-tuning intent (§4.12.5).

## Revision decisions: switch to path 2

1. **§4.12.2** - replace the path-1/path-2 decision with path 2 chosen. The FAB reads `scrollChrome.headerHeight` (reactive getter), NOT `--header-height` via `getComputedStyle`. No caching logic. State the derivation `p = clamp(-scrollChrome.translateY / scrollChrome.headerHeight, 0, 1)`. Note `headerHeight` is seeded `$state(56)` at `scroll-chrome.svelte.ts:65` so division is safe and SSR returns 56 (no NaN edge).
2. **§4.11 / §7 (organic integration / audit gates)** - state honestly that `scroll-chrome.svelte.ts` gains ONE line, a `get headerHeight() { return headerHeight; }` getter mirroring the `translateY` getter at `:215-217`, and that this does NOT violate the organic-clean gate because `headerHeight` is a general scroll-chrome field (per the store docstring at `:9-11`), not an FAB token. The gate is "no `fab` / `post` / `messages` / `discussions` tokens in shared primitives", NOT "zero diff". The §7 `scroll-chrome.svelte.ts` audit gate is revised from "diff empty" to "diff shows ONLY the `get headerHeight()` getter, no FAB tokens".
3. **§9R4** - DROP the "`--header-height` reliably non-empty at first scroll" item (it vanishes under path 2). KEEP "safe-area inset bottom" and "re-confirm no other bottom chrome" (both ACCEPTABLE-DEFERRAL).
4. Keep all other R3+R4 design intact (AppShell placement, module-singleton track store, foregroundFraction scale, A/B/C taxonomy, composed single transform `scale(s) translateY(y)`, pointer-events gate `s < 0.01 || p >= 0.99`, orthogonality, cross-tab chip-exit, inherited Header tuning). No regressions.

Round 5 audit will re-verify path 2 (the getter is correctly placed at `:215-217` shape, the FAB derivation reads `scrollChrome.headerHeight`, no `getComputedStyle` remains, no FAB tokens enter `scroll-chrome.svelte.ts`) plus the unchanged R3+R4 design.

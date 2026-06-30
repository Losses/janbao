# DV09 - Audit Round 5 (FINAL)

5 independent role-less auditors examined `docs/DV09-Plan.md` (Round-4 revision: scroll-driven `translateY` hide-on-scroll via path 2, the `scroll-chrome.svelte.ts` `headerHeight` getter) against the codebase at `master` (`0a03874`). Result: **5/5 PASS (FINAL, unconditional, all organic=clean, all high confidence, zero blocking)**. Loop exit condition met.

## Tally

| Auditor | Verdict | Blocking | Concerns                    | Organic | Confidence |
| ------- | ------- | -------- | --------------------------- | ------- | ---------- |
| 1       | PASS    | 0        | non-blocking (consolidated) | clean   | high       |
| 2       | PASS    | 0        | non-blocking (consolidated) | clean   | high       |
| 3       | PASS    | 0        | non-blocking (consolidated) | clean   | high       |
| 4       | PASS    | 0        | non-blocking (consolidated) | clean   | high       |
| 5       | PASS    | 0        | non-blocking (consolidated) | clean   | high       |

Result line: **5/5 PASS (FINAL, unconditional). Loop exit.**

## Verified-FIXED (Round-4 path-1→path-2 blocker, against source)

- **Path 2 chosen, reactive, in place in the plan.** The FAB derivation is `p = clamp(-scrollChrome.translateY / scrollChrome.headerHeight, 0, 1)` (plan §4.12.3). Both inputs are reactive getters on the same `scroll-chrome` module-singleton store, read inside the FAB layer's `$derived`. No `getComputedStyle` in the FAB path; no `--header-height` read; no caching logic; no duplicate `ResizeObserver`.
- **`headerHeight` getter mirrors the `translateY` getter.** Plan §4.12.2 specifies the getter on the object returned by `getScrollChromeStore()` at `scroll-chrome.svelte.ts:210-232`, mirroring the existing `get translateY() { return translateY; }` at `:215-217` and reading the closure `let headerHeight = $state(56)` at `:65`. The production-precedent proof for the reactivity shape is `Header.svelte:62` (`const translateY = $derived(scrollChrome.translateY);`), which already reads the `translateY` getter in a `$derived` reactively in production; the new `headerHeight` getter has the identical reactive shape, so a `$derived` reading it re-runs on write.
- **Division-safe and SSR-correct.** `headerHeight` is seeded `$state(56)` at `:65` (non-zero). The clamp on `translateY` at `:108-112` keeps `-translateY / headerHeight ∈ [0, 1]`, so `p` is defined and never NaN. SSR returns `56` (the seed; Header's `ResizeObserver` does not fire on the server) so `p = 0` on SSR, the FAB rests at `translateY(0)`. No path-1 empty-string → NaN edge (the entire failure mode that motivated the path-2 switch).
- **Getter is the ONLY `scroll-chrome.svelte.ts` change.** The plan's §4.11 / §5 / §7 are consistent: one new line, the getter; no other change. The store's `hidden`, `scrolling`, `override`, `setHeaderHeight`, `start`, `show`, `setScrollContainer`, `setOverride`, `holdThroughNavigation`, `releaseNavigation` surface is untouched; the `setHeaderHeight` writer at `:185-190` is unchanged and remains the sole writer (Header's existing `ResizeObserver` at `Header.svelte:529-540`).
- **`--header-height` write by Header is unchanged.** `Header.svelte:535` continues to write `--header-height` to `document.documentElement.style`. The FAB does not consume it; Header retains its own write and the var is Header's own.
- **§9R4 timing item DROPPED under path 2.** The "`--header-height` reliably non-empty at first scroll" item (path-1-specific) is removed from the §9R4 UNVERIFIED list and folded into §9.x Resolved with the path-2 rationale (the getter reads the seeded `$state(56)` until Header's ResizeObserver fires). The §9R4 surviving items (`safe-area inset bottom`, `re-confirm no other bottom chrome`) remain ACCEPTABLE-DEFERRAL.

### Reactivity proof (production precedent)

`Header.svelte:57` declares `const scrollChrome = getScrollChromeStore();`. `Header.svelte:62` declares `const translateY = $derived(scrollChrome.translateY);`. Header's title morph during gestures and Header's hide-on-scroll are the live empirical proof that a `$derived` reading a module-singleton getter on the `scroll-chrome` store tracks reactively when the writer (the scroll listener / Header's ResizeObserver) fires. The FAB's new `scrollChrome.headerHeight` read has the identical shape; reading it inside the FAB's `$derived` tracks. The R3 empirical harness (Svelte 5.56.3, `$derived(getActivePrimitive())` tracking `null → el1 → el2 → null`) is the same reactivity contract and is not re-litigated here.

## Confirmed-still-holding (R3 + R4 design, NOT re-litigated)

- **AppShell placement.** `FloatingActionButtonLayer` is rendered by `AppShell.svelte` as a sibling of `<Header>`. AppShell is mounted by the root `+layout.svelte` for every non-`/entry` route via the `showShell` gate, surviving `(tabs)` ↔ top-level nav (thread, conversation, compose). Mobile-only via CSS `md:hidden`, no JS `isMobile` read, matching `Header.svelte:568,572`. No SSR FAB-pop.
- **Module-singleton track store.** `src/lib/stores/active-gesture-track.svelte.ts` mirrors `mobile-pager.svelte.ts:89-120` and `navigation.svelte.ts:264-295` (closure `$state<HTMLElement | null>(null)`, module fallback + `window.__activeGestureTrack`, `initActiveGestureTrack()` called from `+layout.svelte:42-44`, `setActiveGestureTrack(el)` / `clearActiveGestureTrack()` writers, `getActiveGestureTrack()` getter). No `getContext` / `setContext` (the FAB layer is an ancestor of the writers).
- **foregroundFraction scale.** `scale = clamp(2 · foregroundFraction − 1, 0, 1)` (§4.6). Disappear in the first half (foregroundFraction ∈ [0, 0.5] → scale 0), appear in the last half (foregroundFraction ∈ [0.5, 1] → scale rises 0→1). Continuous and identical for drag and snap when `foregroundFraction` is continuous.
- **A/B/C forward-nav taxonomy.** Family A (tab swipe/tap, MobileTabPager track) source at `MobileTabPager.svelte:347` + `switchTo:167-178`. Family B (thread enter/exit, GesturePageLayout track) source at `GesturePageLayout.svelte:240-249,258,869-873` (snapIndex 0→ACTIVE via rAF, CSS `transition-transform duration-200`), `bind:this={trackEl}:918`. Family C (compose, no pager) source at `/post/discussion/+page.svelte` and `/messages/new/+page.svelte` (no GesturePageLayout import). P2 CSS transition on the FAB scale is correct only for Family C; rAF sampler on the track is correct for A and B (the sampler follows the CSS-eased track transform; no double-animation).
- **Composed single transform.** The FAB atom binds ONE `style:transform = "scale(${s}) translateY(${y}px)"` string, mirroring `Header.svelte:570`'s single `style:transform="translateY({translateY}px)"`. One `transform` per rule is mandatory; the composition is correct.
- **pointer-events gate.** Derived class `pointer-events-none` when `s < 0.01 || p >= 0.99` (§4.12.7). `aria-hidden` mirrors the combined condition. Not a per-frame inline mutation.
- **Orthogonality (§4.12.4).** `scale` (uniform axes multiplier around center origin) and `translateY` (Y-axis shift) compose on different matrix dimensions; no precedence rule, no conflict. The route-transition driver and the scroll driver never contend for the same channel.
- **Cross-tab chip-exit (§4.7).** Layer reads `navStore.pendingNav !== null || navStore.navInFlight` and forces `scale = 0` directly (not via `foregroundFraction`). The OR form matches `GesturePageLayout.svelte:99-100,371-372`; both fields exposed at `navigation.svelte.ts:95-105`.
- **Inherited Header tuning (§4.12.5).** Because `p` derives from `scrollChrome.translateY`, the FAB inherits `TOP_THRESHOLD = 8` (`scroll-chrome.svelte.ts:58`), direction hysteresis (`:107-114`), `holdThroughNavigation` / `releaseNavigation` (`:196-208`), and `frozen` (`:74`). The FAB does not re-derive thresholds; it echoes the Header.
- **scroll-chrome active on list routes (§4.12.2).** `(tabs)/+layout.svelte:108` reads `window.scrollY`; `/`, `/activity`, `/messages/inbox` are not under `fixed-viewport`, so the default window scroll listener at `scroll-chrome.svelte.ts:145-146` fires and drives `translateY`. The FAB's `$derived` tracks.
- **No bottom chrome (§4.12.6).** `MobileTabBar.svelte:79` is a `<nav>` row of pills rendered inside the Header at `Header.svelte:620`, not a bottom bar. `rg "fixed.*bottom|bottom-nav"` over `src` returns zero navigation-chrome hits. The FAB at `bottom-1rem right-1rem` slides off the viewport bottom edge into empty space; no sibling bottom chrome to reconcile z-index with.

## Organic integration — CLEAN (all 5)

The audit gate is **"no FAB-named tokens (`fab` / `post` / `messages` / `discussions`) enter shared primitives"**, NOT "zero diff to `scroll-chrome.svelte.ts`". `headerHeight` is a general scroll-chrome field: the store docstring at `scroll-chrome.svelte.ts:9-11` describes it as "the current viewport's header height" attributed to Header's ResizeObserver, and `setHeaderHeight` (the writer, at `:185-190`) is already part of the public surface. Exposing the read parallels the existing `translateY` / `hidden` / `scrolling` / `override` getters. The one-line `get headerHeight()` getter adds zero FAB tokens. The prior path-1 "byte-identical `scroll-chrome.svelte.ts`" framing is correctly gone.

`git diff` gate per §7:

- `MobileTabPager.svelte` shows ONLY `let trackEl = $state`, `bind:this={trackEl}`, `setActiveGestureTrack(trackEl)`, `clearActiveGestureTrack()` (no FAB import, no feature branch, no `fab` / `post` / `messages` / `discussions` strings).
- `GesturePageLayout.svelte` shows ONLY `setActiveGestureTrack(trackEl)` and `clearActiveGestureTrack()` (the `trackEl` declaration and `bind:this` already exist at `:250` / `:918`).
- `AppShell.svelte` shows ONLY the one `<FloatingActionButtonLayer t={t} />` render line.
- `+layout.svelte` (root) shows ONLY the one `initActiveGestureTrack();` call alongside the existing inits.
- `scroll-chrome.svelte.ts` shows ONLY the `get headerHeight() { return headerHeight; }` getter mirroring `translateY` at `:215-217`.
- `swipe.ts`, `tab-config.ts`, `mobile-tabs.ts`, `navigation-logic.ts`, `navigation.svelte.ts`, `Header.svelte`, `MobileTabBar.svelte`, `(tabs)/+layout.svelte`, `DualColumnLayout.svelte`, `+layout.server.ts` all empty (zero diff).
- No `setContext` / `getContext` call referencing `'activeGestureTrack'` appears anywhere in the diff.

The new module store `active-gesture-track.svelte.ts` is named for the gesture concept (the live track of the active gesture surface), not the FAB; it lives in `src/lib/stores/` alongside the pager/nav stores that already follow this exact pattern.

### No side effects from the new getter (grep-verified)

All 5 auditors grep'd for existing `scrollChrome.headerHeight` readers. Zero hits. The getter is purely additive read access on an already-internal `$state`; the `setHeaderHeight` writer at `:185-190` is unchanged and remains the sole writer. The reactive graph is: Header's `ResizeObserver` → `setHeaderHeight(h)` → closure `$state` write → FAB `$derived` re-runs. No other consumer of `headerHeight` is introduced or affected by the change.

## §9 carried items — ACCEPTABLE-DEFERRAL (all 5)

- **`size-14` owner-confirm before implementation.** FAB diameter `size-14` (56px) has no codebase precedent (`BookmarkButton.svelte:76` uses `btn-circle btn-sm`). Marked for designer confirmation before implementation; if a different diameter is specified, only the `size-*` class on the atom changes. The R4 `translateY` magnitude `fabHeight + bottomClearance` is computed FROM this diameter, so a diameter change updates the slide distance in lockstep (no separate tuning). Deferral acceptable because the rest of the plan is diameter-agnostic.
- **Safe-area inset bottom (§4.12.6).** The repo has zero `env(safe-area-inset-bottom)` usage today (verified `rg "safe-area"` over `src` returns nothing). The resting `bottom: 1rem` and `bottomClearance = 1rem` may clip the iOS home indicator. Designer confirms whether `bottom` should be `calc(1rem + env(safe-area-inset-bottom))`; if so, both the resting offset and the slide distance update together. ACCEPTABLE-DEFERRAL.
- **Re-confirm no other bottom chrome (§4.12.6).** `MobileTabBar` is the top-Header pill row (`Header.svelte:620`); no bottom bar exists today. Auditor re-confirms no future bottom nav or OS-level PWA bar the FAB would slide through. If one is planned, the slide-down z-index reconciliation and `bottomClearance` must be revisited. ACCEPTABLE-DEFERRAL.
- **`$effect.pre` same-flush re-run on the sampler arm/disarm effect (carried from R3, not path-2-related).** The arm/disarm effect is plain `$effect` (not `.pre`) per memory `svelte-effect-pre-same-flush-rerun`. The plan correctly does NOT assert static safety; it marks empirical e2e verification as an implementation gate (the "remove the guard, run the e2e sampler" prescription). All five auditors accept the deferral with the gate intact.

## Non-blocking concerns (carried to implementation, NOT re-audited)

- **(a) Minor citation drift in the plan.** `AppShell.svelte` line refs (plan cites `:45,57`; `:45` is the `getScrollChromeStore().start()` onMount, `:57` is the `<Header>` sibling, and the FAB render line is the next sibling, not separately cited). `app.css` fixed-viewport line range (plan cites `:244-255`; verified actual `:245-247` for the `position: fixed` block, with the surrounding selectors at `:244` and `:288-294`). Cosmetic; substance correct.
- **(b) `p >= 0.99` pointer-events threshold is one epsilon off the store's `hidden` flag.** The store's `hidden` flag fires at `translateY <= -headerHeight` (`scroll-chrome.svelte.ts:115`); the FAB gate fires at `p >= 0.99`, i.e. marginally before the FAB is fully off-screen. The intent (a tap cannot land on a partially-visible button) holds. Could be tied to the clamp math explicitly in implementation; sound as-is.
- **(c) `$effect.pre` same-flush re-run on the sampler arm/disarm effect.** Carried from R3 (see §9 above). The plan correctly uses plain `$effect` and flags empirical e2e verification. Not path-2-related.
- **(d) `size-14` (56px) owner-confirm before implementation.** No codebase precedent. Designer-confirm; if a different diameter is specified, only the `size-*` class on the atom changes.
- **(e) Safe-area inset bottom.** `env(safe-area-inset-bottom)` is unused in the repo today. Designer-confirm; resting `bottom` + `bottomClearance` update together if required.

## Loop-exit statement

Loop exit condition met: 5/5 unconditional PASS. Plan approved for implementation (includes the R4 scroll-driven `translateY` hide-on-scroll). Implementation proceeds under `DV09-C00-Journal.md` + `RV09-C00-Audit-##` (per the DV08 pattern).

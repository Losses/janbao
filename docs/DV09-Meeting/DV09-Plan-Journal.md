# DV09 - Plan Journal

Append-only log of the 5-agent role-less full-audit loop for the mobile Floating Action Button. Each round: 5 independent auditors examine `docs/DV09-Plan.md` against the real codebase; loop until 5/5 unconditional PASS (DV04 pattern). Owner-locked decisions (placement bottom-right, ActionBar color mapping, mobile-only, first-50%-disappear / last-50%-appear) are not relitigated. NOTE: the R3 "always-visible" lock was SUPERSEDED in R4 by the owner (hide-on-scroll via translateY, echoing the Header); see the Round 4 entry below.

## Round 1 - 0/5 PASS → revised

All five auditors returned `has-special-cases`, high confidence. Full detail: `DV09-Audit-R1.md`.

Convergent blockers:

- **B1 (CRITICAL, 5/5).** FAB layer in `(tabs)/+layout.svelte` unmounts on every FAB-relevant destination. Verified: `/discussion/*`, `/messages/[id]`, `/post/discussion`, `/messages/new` are all TOP-LEVEL; `MobileTabPager` is imported only by `(tabs)/+layout.svelte:22,129`. The `mobile-thread-overlay-persistent-pager.md` memory is SUPERSEDED 2026-06-27. Tapping the FAB or a discussion card unmounts the layer at the route swap with no scale-out; back-swipe thread→list has no FAB consumer until the list mounts; deep-link to a thread never mounts it.
- **B2 (HIGH/CRITICAL, 5/5).** `backMorph` is permanently `null` for centerTab routes. `GesturePageLayout.svelte:338-360` returns early after `pager.set({..., backMorph: null})` when `centerTab !== undefined`; both thread routes pass `centerTab`. The continuous progress lives on `fractionalIndex` (line 353), not `backMorph`.
- **B3 (HIGH, auditor 2).** `OverlayLayer.svelte` does not exist. The thread overlay IS `GesturePageLayout.svelte`; its center `.gpl-card` is the opaque cover.
- **B4 (HIGH, auditors 4, 5).** Compose routes (`/post/discussion`, `/messages/new`) have no GesturePageLayout, no track, no signal to sample. Thread-enter DOES animate the GPL track (snapIndex 0→ACTIVE via rAF, CSS transition over 200ms), so the GPL sampler covers forward thread-enter; P2 is needed only for compose.
- **B5 (HIGH, auditors 1, 2, 5).** `use:trackSnapProgress` writing to `fab-scale.svelte.ts` from MobileTabPager/GesturePageLayout injects FAB tokens into shared primitives; `trackEl` is local to MobileTabPager and not exported.

Revision decisions:

- **Placement → AppShell (rendered by root layout).** Mirrors Header, which the root layout mounts specifically to survive `(tabs)`↔standalone nav. Layer reads `page.url.pathname` + primary pager store (reachable via `getMobilePagerStore()` module fallback set by `initMobilePagerStore()` in root). Mobile-only via CSS `md:hidden`, not JS `isMobile` (matches Header, removes SSR FAB-pop).
- **Signal re-derivation.** `foregroundFraction` reads `fractionalIndex`, not `backMorph`. New runes-free util `fab-routes.ts` exports `isOverlayRoute(pathname)` (matches `/discussion/`, `/messages/<digit>`), evaluated BEFORE tab index. Discussions FAB only on `/`; Messages FAB only on `/messages/inbox`; both hidden on overlay/compose.
- **Forward-nav taxonomy.** (A) tab swipe/tap → MobileTabPager track sampler; (B) thread enter/exit → GesturePageLayout track sampler (GPL writes primary store during both forward-enter and back-swipe); (C) compose route-swap → P2 CSS transition on FAB scale via `beforeNavigate`/`afterNavigate`. P2 justified ONLY for (C).
- **Organic-integration redesign.** Sampler lives inside the FAB layer; active track reaches it via Svelte context keyed `'activeGestureTrack'` (non-FAB name), set by MobileTabPager/GesturePageLayout via one-line `setContext` with NO FAB import. Zero FAB tokens in shared primitives.
- **OverlayLayer removed.** Section 3 rewritten against the real component graph.
- **Deferred items pinned.** FAB `size-14` (56px) with rationale, marked owner-confirm; cross-tab chip-exit contract = `navStore.pendingNav !== null` forces scale 0; z-index under AppShell stacking + `fixed-viewport` verified; `onDestroy` rAF teardown `browser`-guarded.
- **Two-writer resolution.** FAB-scale store keyed by surface; only the active surface's sampler writes.

## Round 2 - 0/5 PASS → revised

All five auditors returned `has-special-cases`, high confidence. Full detail: `DV09-Audit-R2.md`. All Round-1 fixes VERIFIED-FIXED (AppShell placement, `fractionalIndex` signal, A/B/C taxonomy for route shapes and tracks, OverlayLayer removal, deferred items). Single convergent blocker on the `'activeGestureTrack'` channel.

Convergent blockers:

- **B1 (CRITICAL, 5/5).** `'activeGestureTrack'` Svelte context is directionally impossible. The FAB layer in AppShell is an ANCESTOR of `MobileTabPager` / `GesturePageLayout`; `getContext` walks the `.parent` chain upward only (`node_modules/svelte/types/index.d.ts:497,503,512`; `context.js`). `getContext('activeGestureTrack')` in AppShell returns `undefined` unconditionally. Every existing `setContext` in the repo is ancestor-owns (`+layout.svelte:118` `app:lang`; `mobile-pager.svelte.ts:99,124`; `navigation.svelte.ts:274`, all initialized from `+layout.svelte:42-44`). Zero precedent for descendant → ancestor. The §9 fallback ("read via `getContext` on each `afterNavigate` tick") is the same broken call (`setContext` captures at call time; the new route's `bind:this` fires after `afterNavigate`).
- **B2 (HIGH, auditors 2, 5).** `MobileTabPager.svelte` has no `trackEl`. `grep bind:this` returns only `deepPreviewEl` (line 401); the line-347 track div has no binding; track style is a derived string (`trackStyle:132-136`). The "ONE line `setContext('activeGestureTrack', trackEl)`" instruction is unimplementable. `GesturePageLayout.svelte:250,918` does have `trackEl` + `bind:this` - single publication line holds there.
- **B3 (HIGH, auditors 3, 5).** "General capability" framing is post-hoc. No plausible second consumer of `'activeGestureTrack'`; `GesturePageLayout.startPendingNavPoll:538-586` samples its own closure `trackEl`. The integration is FAB-only and should be owned honestly.

Secondary (non-blocking, addressed in revision):

- **navInFlight gap (auditors 2, 5).** Cross-tab chip-exit contract must be `navStore.pendingNav !== null || navStore.navInFlight`; `executePendingNav:194` clears `pendingNav` and sets `navInFlight` before `afterNavigate` clears it. `GesturePageLayout.svelte:99-100,371-372` already uses the OR form. Layer short-circuits scale → 0 directly (not via `foregroundFraction`).
- **Single-frame retarget claim is false (auditor 2 B3).** Replaced with explicit sequencing: sampler arms on store-becomes-non-null, disarms on null; during the no-track gap the scale holds its last value (route swap is not mid-gesture on the lost track).
- **§4.6 two-writer over-specified (auditor 2).** One sampler feeds sampled `fractionalIndex`; per-FAB scale = `clamp(2 · tabFraction(sampledFractionalIndex, tabIndex) − 1, 0, 1)`. Per-surface store dropped.
- **`$effect.pre` same-flush re-run (auditor 5).** Arm/disarm is plain `$effect`; verify empirically. UNVERIFIED - Round 3.

Revision decisions:

- **Module-singleton track store.** [B1] Replace the context channel with `src/lib/stores/active-gesture-track.svelte.ts` mirroring `mobile-pager.svelte.ts:89-120` + `navigation.svelte.ts:264-295`: closure `$state<HTMLElement | null>(null)`, `setActiveGestureTrack(el)` / `clearActiveGestureTrack()`, `getActiveGestureTrack()` getter, `initActiveGestureTrack()` called once from `+layout.svelte:42-44`. `MobileTabPager` / `GesturePageLayout` write the live `trackEl`; the FAB layer reads it in a `$derived` / `$effect` so the read re-runs on track change. No `getContext` / `setContext`. Reactive exactly the way `getMobilePagerStore().fractionalIndex` in a `$derived` tracks (closure `$state` read through a getter).
- **Honest `MobileTabPager` edit.** [B2] Add `let trackEl = $state<HTMLElement | null>(null)` + `bind:this={trackEl}` on the line-347 track div + `setActiveGestureTrack(trackEl)` in the bind `$effect` + `clearActiveGestureTrack()` in `onDestroy`. Counted as 4 lines (declaration + bind + set + clear). `GesturePageLayout` adds only the set + clear lines (its `trackEl` already exists at line 250/918).
- **Retarget sequencing.** [B2 B3-concern] Replace "single-frame retarget" with the real bind/unbind sequencing; during the no-track gap the scale holds its last value.
- **Own the organic claim honestly.** [B3] Drop "general capability". State the integration as an audited one-paragraph publication of the track element to a shared module store, solely consumed by the FAB sampler. Audit gate: diff to each shared primitive contains ONLY `bind:this` / declaration / publication lines, with NO FAB-named tokens. DV08 clean = no feature-named tokens, not zero lines.
- **navInFlight fix.** [navInFlight gap] Contract = `pendingNav !== null || navInFlight`; layer short-circuits scale → 0 directly.
- **§4.6 simplification.** [B1-concern] One sampler, per-FAB derivation from sampled `fractionalIndex`; drop the per-surface store.
- **§9 UNVERIFIED cleared.** Context reactivity moot (module store). Fixed-viewport drift reasoned via Header existence proof (`Header.svelte:568,572` same AppShell level, `sticky z-40`, no drift under `app.css:244-255`); portal fallback noted. `size-14` owner-confirm must resolve before plan approval. `$effect.pre` same-flush re-run UNVERIFIED - Round 3.

## Round 3 - 5/5 PASS (FINAL, unconditional). Loop exit.

All five auditors returned PASS, organic=clean, high confidence. Full detail: `DV09-Audit-R3.md`. The reactivity linchpin (closure `$state<HTMLElement | null>` read through a module-singleton getter inside an ancestor `$derived`, tracking on descendant writes) is VERIFIED two ways: production precedent (`MobileTabBar.svelte:49`, `Header.svelte:57-59,74` reading `getMobilePagerStore()`) and an empirical harness (Svelte 5.56.3, `$derived` tracked `null → el1 → el2 → null` across three writes). All Round-2 fixes VERIFIED-FIXED against source. §9 carried items ACCEPTABLE-DEFERRAL with empirical e2e gate intact.

Loop exit condition met. Plan approved for implementation.

Carried-to-implementation notes (non-blocking, NOT re-audited):

- (a) **§4.8 Header citation technically imprecise.** Header is promoted sticky→fixed by `html.fixed-viewport header { position: fixed }` at `app.css:288-294`, not generic sticky semantics. Conclusion holds: no transformed ancestor between AppShell and the FAB, so the FAB anchors to the viewport.
- (b) **§4.5 "bind $effect" wording.** A NEW `$effect` must be added to `MobileTabPager.svelte` (the existing `onMount` return-teardown is not the same effect); `GesturePageLayout.svelte` can reuse its existing bind `$effect`. §5 line count already accounts for it.
- (c) **§4.6 dragFraction writer under-specified.** During drag use `tabFraction(pager.fractionalIndex, tabIndex)` directly (store field is continuous during drag); the sampler writes only the snap-phase `snapFraction`.
- (d) **`MobileTabPager` has no `onDestroy` import today.** Add `onDestroy` from `svelte`, or reuse the `onMount` return-teardown pattern (`:100-103`). Either path acceptable; pick explicitly.
- (e) **`getActiveGestureTrack()` SSR null-safety implicit.** State it: during SSR `track === null`, sampler no-op, FAB renders at the path-predicate resting scale.
- (f) **Sampler stays armed on `/profile` routes.** No FAB renders; minor wasted rAF. Acceptable.
- (g) **`isOverlayRoute` `/^\/messages\/\d/` future-route note.** A future `/messages/settings` would not match; deliberate per current route inventory.

Implementation proceeds under `DV09-C00-Journal.md` + `RV09-C00-Audit-##` (per the DV08 pattern).

## Round 4 - spec-change revision (audit pending)

The owner changed a Round-3 owner-locked decision post-approval. R3 locked "always visible (no scroll-hide)"; R4 replaces it with hide-on-scroll via `translateY`, echoing the Header. The rest of the R3-approved design (AppShell placement, module-singleton track store, foregroundFraction scale, A/B/C taxonomy) is unchanged and is NOT re-litigated.

Owner-locked R4 mechanism (verified against source before writing):

- The FAB `transform` is a SINGLE composed property: `scale(s) translateY(y)`. One `style:transform` string, mirroring Header's single `style:transform="translateY({translateY}px)"` at `Header.svelte:570`.
- `scale(s) = clamp(2 · foregroundFraction − 1, 0, 1)`. UNCHANGED from R3.
- `translateY(y)` is a NEW independent driver from scroll. `p = clamp(-scrollChrome.translateY / headerHeight, 0, 1)`; `y = p · (fabHeight + bottomClearance)`. The FAB reads the existing `scroll-chrome` store exactly as Header does (`Header.svelte:57,62`); no new store.

Rationale (stated explicitly in §4.12.4): `scale` and `translateY` are orthogonal CSS transform components on different matrix dimensions. The route-transition driver and the scroll driver do NOT compose on the same dimension, so there is no precedence rule and no conflict. This is why the owner chose translateY over a scale-based scroll-hide (a scale-based hide would contend with the route-transition `scale` on the same channel and require a precedence rule).

The FAB INHERITS the Header's scroll tuning (`TOP_THRESHOLD`, direction hysteresis, `holdThroughNavigation`/`releaseNavigation`, `frozen`) by reading the Header-derived `translateY`. This is DESIRABLE: the intent is to echo the Header's motion in sync, not to introduce independent FAB scroll logic.

Source verification (file:line) done before writing:

- `scroll-chrome.svelte.ts:215-217` exposes `translateY` as a reactive getter (closure `$state` at line 61).
- `scroll-chrome.svelte.ts:210-232` does NOT expose `headerHeight` as a getter; only `hidden`, `translateY`, `scrolling`, `override` are getters. This forced a decision: read `--header-height` (written by `Header.svelte:535` in the same ResizeObserver that calls `setHeaderHeight`) and keep `scroll-chrome.svelte.ts` byte-identical, OR add a `get headerHeight()` getter and break the R3 audit gate. Chose the former (§4.12.2 path 1) to preserve `git diff -- scroll-chrome.svelte.ts` empty.
- `Header.svelte:529-540` confirmed: ResizeObserver fires on `observe(headerEl)`, writes `--header-height` and calls `setHeaderHeight` in the same callback. The `--header-height` var is populated on every AppShell mount before the user can scroll.
- `AppShell.svelte:45,57` confirmed: `getScrollChromeStore().start()` in onMount; Header is the sibling the FAB layer sits next to. The FAB's scroll-chrome read is the same low-coupling read Header already does.
- `(tabs)/+layout.svelte:108` confirmed: list routes read `window.scrollY` (window scrolls, not under `fixed-viewport`), so the default window scroll listener at `scroll-chrome.svelte.ts:145-146` drives `translateY` on `/`, `/activity`, `/messages/inbox`.

Premise correction (the brief was wrong on one point):

- The Round-4 brief's "FAB slides through the MobileTabBar region / determine the tab bar's z-index" item assumes a bottom tab bar. `MobileTabBar.svelte:79` is a `<nav>` row of pills rendered INSIDE the Header at `Header.svelte:620`. There is NO bottom tab bar in the codebase (`rg "fixed.*bottom|bottom-nav"` over `src` returns zero navigation-chrome hits). The FAB slides off the viewport bottom edge into empty space; no sibling bottom chrome to reconcile z-index with. Documented in §4.12.6.

Revision decisions (concrete changes to `docs/DV09-Plan.md`):

1. Status header → "Draft under 5-agent audit loop. Round 4 (spec change: hide-on-scroll via translateY, echoing Header)."
2. §2.2 confirmed requirement: "always visible" → hide-on-scroll via translateY; noted as superseding the R3 lock.
3. §3.2 file inventory: added R4 source confirmations (Header.svelte:529-540,57,62; scroll-chrome.svelte.ts:58,61,65,107-116,185-190,210-232; AppShell.svelte:45,57; MobileTabBar.svelte:79; (tabs)/+layout.svelte:108).
4. New §4.12 (eight sub-sections): composed transform, scroll signal + path-1 decision, hide-progress derivation, orthogonality rationale, inherited Header tuning, tab-bar/edge geometry correction, pointer-events gating, R4-specific edge cases.
5. §4.8 pointer-events bullet: gate is now `s < 0.01 || p >= 0.99`.
6. §5 Files: FAB atom and layer props/signature updated to carry `s` and `p`; "Unchanged" list explicitly notes R4 does NOT modify `scroll-chrome.svelte.ts` (path 1) and that the store's behaviors are inherited through the `translateY` read.
7. §6 Edge cases: added items 17-22 (R4 translateY edge cases).
8. §7 Testing: added R4 scroll-driven translateY e2e items (transform sampling, pointer-events assertion, compose/chip-exit, route-arrival-with-restored-scroll).
9. §8 Out of scope: replaced "Scroll-hide coupling (FAB is always visible)" with "FAB-specific scroll tuning that diverges from the Header".
10. §9 split into §9 (R3 items, kept) and new §9R4 (R4 UNVERIFIED: `--header-height` reliability, safe-area inset, tab-bar premise re-confirm).

Round 4 audit pending. The audit must verify (a) the orthogonality argument holds under live scroll+transition, (b) `--header-height` is reliably non-empty at first scroll on `/`, (c) the absence of any bottom chrome the slide-down would interact with, (d) the pointer-events gate fires before the FAB is interactable, (e) the inherited Header tuning (hold/release/frozen) does what §4.12.5 claims.

## Round 4 - 3/5 PASS, 2/5 FAIL → revised (path 2)

5 independent role-less auditors examined the Round-4 revision (`docs/DV09-Plan.md` with §4.12 added: hide-on-scroll via `translateY`, echoing the Header) against the codebase at `master` (`0a03874`). Result: **3/5 PASS, 2/5 FAIL** (not unanimous; NOT a loop exit). Full detail: `DV09-Audit-R4.md`.

All 5 auditors verified the R4 mechanism is structurally sound: the `translateY` getter is reactive (`scroll-chrome.svelte.ts:215-217` reading `$state` at `:61`); the derivation math is sound (clamp `[-headerHeight, 0]` at `:108-112`, seed `56` at `:65`); the composed single `style:transform = "scale(${s}) translateY(${y}px)"` mirrors `Header.svelte:570`; `scale` and `translateY` are orthogonal; `scroll-chrome` is active on the list routes (`(tabs)/+layout.svelte:108`); there is no bottom chrome (`MobileTabBar.svelte:79` is rendered inside the Header at `Header.svelte:620`); no R3 regression.

Convergent blocker (B1, HIGH):

- **Path 1 (read `--header-height` via `getComputedStyle`) is wrong; switch to path 2 (add a `get headerHeight()` getter to `scroll-chrome.svelte.ts`).** Three independent grounds, all 5 agree:
  1. CSS custom properties are NOT Svelte-reactive. `getComputedStyle(...).getPropertyValue('--header-height')` is an untracked read; the FAB's `$derived` re-runs only because `scrollChrome.translateY` is also tracked.
  2. PERF: if read inside the per-scroll-frame `$derived` it is a forced reflow on `<html>` every scroll frame. The plan's "cached, re-read only when needed" does not specify the invalidation signal; the only sound one is a `ResizeObserver` on `headerEl`, which `Header.svelte:529-540` ALREADY runs (calling `setHeaderHeight` AND writing `--header-height` in the same callback). Path 1 forces a redundant duplicate observer OR accepts stale `headerHeight` across a Header resize. `Header.svelte:570` itself uses NO per-frame `getComputedStyle`.
  3. The justification misreads the R3 organic-clean gate. Per `DV09-Audit-R3.md` and this journal's Round 3 entry, the gate is "no FAB-named tokens (`fab` / `post` / `messages` / `discussions`) enter shared primitives", NOT "zero diff to `scroll-chrome.svelte.ts`". `headerHeight` is a general scroll-chrome concept (the store's own docstring at `scroll-chrome.svelte.ts:9-11` describes it as "the current viewport's header height" attributed to Header's ResizeObserver); exposing it as a getter adds NO FAB token. This is the same honest form R3 endorsed for the `active-gesture-track` store. The plan's deference to the literal "`git diff -- scroll-chrome.svelte.ts` empty" gate is over-conservative.

PASS-vs-FAIL split:

- Auditors 1, 2, 5 PASS: functionally correct as specified; path-1 perf manageable with implementer caching discipline; but path 2 strictly cleaner and does NOT actually violate the organic-clean gate.
- Auditors 3, 4 FAIL (B1 HIGH): per-frame reflow antipattern and misread-gate justification are blocking.

Revision decision (owner mandate): switch to path 2.

1. Add one line to the object returned by `getScrollChromeStore()` at `scroll-chrome.svelte.ts:210-232`:
   ```
   get headerHeight() {
       return headerHeight;
   },
   ```
   mirroring the existing `translateY` getter at `:215-217`, reading the closure `$state(56)` at `:65`.
2. The FAB derivation becomes `p = clamp(-scrollChrome.translateY / scrollChrome.headerHeight, 0, 1)`. Fully reactive; zero `getComputedStyle`; zero per-frame reflow; zero duplicate observer; zero SSR/first-paint edge.
3. §4.11 / §7 state honestly that `scroll-chrome.svelte.ts` gains ONE line (the getter) and that this does NOT violate the organic-clean gate. The §7 `scroll-chrome.svelte.ts` audit gate is revised from "diff empty" to "diff shows ONLY the `get headerHeight()` getter, no FAB tokens".
4. §9R4 DROP the "`--header-height` reliably non-empty at first scroll" item (it was path-1-specific and vanishes under path 2; the getter reads the seeded `$state(56)` until Header's ResizeObserver fires). Auditor 3 notes the §9R4 timing item existing at all is itself evidence path 1 was wrong. KEEP "safe-area inset bottom" and "re-confirm no other bottom chrome" (both ACCEPTABLE-DEFERRAL, verified zero `safe-area` usage and zero bottom chrome today).

All other R3+R4 design is unchanged: AppShell placement, module-singleton track store, foregroundFraction scale, A/B/C taxonomy, composed single transform `scale(s) translateY(y)`, pointer-events gate `s < 0.01 || p >= 0.99`, orthogonality (§4.12.4), inherited Header tuning (§4.12.5), cross-tab chip-exit (`pendingNav !== null || navInFlight`).

Round 5 audit will re-verify path 2 plus the unchanged R3+R4 design.

## Round 5 - 5/5 PASS (FINAL, unconditional). Loop exit.

5 independent role-less auditors examined `docs/DV09-Plan.md` (Round-4 revision: path 2, the `scroll-chrome.svelte.ts` `headerHeight` getter) against the codebase at `master` (`0a03874`). Result: **5/5 PASS (FINAL, unconditional, all organic=clean, all high confidence, zero blocking)**. Full detail: `DV09-Audit-R5.md`.

All 5 verified the path-2 fix is in place and reactive. The FAB derivation is `p = clamp(-scrollChrome.translateY / scrollChrome.headerHeight, 0, 1)` (§4.12.3); both inputs are reactive getters on the same `scroll-chrome` module-singleton store read inside a `$derived`. The reactivity shape is proven by `Header.svelte:62` (`const translateY = $derived(scrollChrome.translateY);`) already reading the `translateY` getter reactively in production; the new `headerHeight` getter (§4.12.2) has the identical shape and tracks the same way. Division is defined (`headerHeight` seeded `$state(56)` at `scroll-chrome.svelte.ts:65`, clamp on `translateY` at `:108-112` keeps the ratio in `[0,1]`); SSR returns `56` so `p = 0`, no NaN edge. The getter is the ONLY `scroll-chrome.svelte.ts` change (one line, mirroring `translateY` at `:215-217`); `setHeaderHeight` writer unchanged; Header's existing `ResizeObserver` remains the sole writer. No `getComputedStyle`, no `--header-height` read, no duplicate observer, no caching logic. Grep confirms zero existing `scrollChrome.headerHeight` readers; the getter is purely additive read access.

The R3 organic-clean gate is restated honestly: "no `fab` / `post` / `messages` / `discussions` tokens in shared primitives", NOT "zero diff". `headerHeight` is a general scroll-chrome field (store docstring at `:9-11`); the getter adds no FAB tokens. The prior path-1 "byte-identical `scroll-chrome.svelte.ts`" framing is gone. §9R4 "`--header-height` reliably non-empty at first scroll" is dropped (path-1-specific; folded into §9.x Resolved). Surviving §9R4 items (`safe-area inset bottom`, `re-confirm no other bottom chrome`) ACCEPTABLE-DEFERRAL.

No R3+R4 regression: AppShell placement, module-singleton track store, foregroundFraction scale, A/B/C taxonomy, composed single transform `scale(s) translateY(y)`, pointer-events gate `s < 0.01 || p >= 0.99`, orthogonality (§4.12.4), cross-tab chip-exit (`pendingNav !== null || navInFlight`), inherited Header tuning (§4.12.5), scroll-chrome active on list routes (window scroll), no bottom chrome (`MobileTabBar` is the in-Header pill row). All intact.

Loop exit condition met. Plan approved for implementation (includes the R4 scroll-driven `translateY` hide-on-scroll).

Carried-to-implementation notes (non-blocking, NOT re-audited):

- (a) Minor citation drift in the plan. `AppShell.svelte` line refs (`:45,57` vs actual `:57` Header / `:58` children), `app.css` fixed-viewport line range (`:244-255` vs actual `:245-247`). Cosmetic; substance correct.
- (b) `p >= 0.99` pointer-events threshold is one epsilon off the store's `hidden` flag (`translateY <= -headerHeight` at `:115`); could be tied to clamp math at implementation. Sound as-is.
- (c) `$effect.pre` same-flush re-run on the sampler arm/disarm effect (carried from R3). Plan uses plain `$effect` and flags empirical e2e verification. Not path-2-related.
- (d) `size-14` (56px) owner-confirm before implementation. No codebase precedent.
- (e) Safe-area inset bottom (`env(safe-area-inset-bottom)` unused in repo today). Designer-confirm; resting `bottom` + `bottomClearance` update together if required.

Implementation proceeds under `DV09-C00-Journal.md` + `RV09-C00-Audit-##` (per the DV08 pattern).

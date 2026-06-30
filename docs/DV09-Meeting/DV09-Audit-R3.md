# DV09 - Audit Round 3 (FINAL)

5 independent role-less auditors examined `docs/DV09-Plan.md` (Round-2 revision) against the codebase at `master` (`0a03874`). Result: **5/5 PASS (FINAL, unconditional, all organic=clean, all high confidence)**. Loop exit condition met.

## Tally

| Auditor | Verdict | Blocking | Concerns | Organic | Confidence |
| ------- | ------- | -------- | -------- | ------- | ---------- |
| 1       | PASS    | 0        | 3        | clean   | high       |
| 2       | PASS    | 0        | 3        | clean   | high       |
| 3       | PASS    | 0        | 2        | clean   | high       |
| 4       | PASS    | 0        | 2        | clean   | high       |
| 5       | PASS    | 0        | 3        | clean   | high       |

Result line: **5/5 PASS (FINAL, unconditional). Loop exit.**

## Verified-FIXED (all Round-2 blockers, against source)

- **B1 module-singleton track store.** `src/lib/stores/active-gesture-track.svelte.ts` is specified to mirror `mobile-pager.svelte.ts:89-120` and `navigation.svelte.ts:264-295` exactly (closure `$state<HTMLElement | null>(null)`, module `globalActiveGestureTrackFallback` + `window.__activeGestureTrack`, `initActiveGestureTrack()` invoked from `+layout.svelte:42-44`, `setActiveGestureTrack` / `clearActiveGestureTrack` writers, `getActiveGestureTrack()` getter). The pattern is proven in the codebase for the pager and nav stores, which is the documented precedent for ancestor-readable reactive module state. No `getContext` / `setContext`.
- **B2 MobileTabPager trackEl edit.** `MobileTabPager.svelte:347` track div has no `bind:this` today (`grep bind:this` returns only `deepPreviewEl:401`); the 4-line edit (`let trackEl = $state<HTMLElement | null>(null)` + `bind:this={trackEl}` + `setActiveGestureTrack(trackEl)` in the bind `$effect` + `clearActiveGestureTrack()` in `onDestroy`) is what the plan specifies. `GesturePageLayout.svelte` already has `trackEl` at line 250 and `bind:this` at line 918; only the set + clear lines are added there.
- **B3 honest organic claim.** The plan drops the "general capability" framing. The audit gate is restated as: the diff to each shared primitive contains ONLY `bind:this` / declaration / publication / clear lines, with NO FAB-named tokens (`fab`, `post`, `messages`, `discussions`) imported or referenced. The store name `active-gesture-track` parallels the existing `scroll-chrome.svelte.ts` precedent (a general tracking store with specific consumers). Clean = no feature-named tokens, not zero lines.
- **navInFlight OR-form.** §4.7 specifies `navStore.pendingNav !== null || navStore.navInFlight`, matching `GesturePageLayout.svelte:99-100,371-372`. Both fields exposed at `navigation.svelte.ts:95-105`. The layer short-circuits to `scale = 0` directly (not via `foregroundFraction`).
- **§4.6 simplification.** Per-surface store dropped. One sampler writes a single `sampledFractionalIndex`; each FAB derives its own scale from that one source via the pure `tabFraction` / `pxToFraction` / `scaleFromFraction` functions in `fab-scale.ts`.
- **Retarget sequencing.** The false "single-frame retarget" claim is replaced with the real sequencing: sampler arms when the module store's track becomes non-null, disarms when it goes null; during the no-track gap the scale holds its last value. A route swap that crosses the Family A→B boundary does not happen mid-gesture on the lost track (the gesture commits, then the route swaps).

### Reactivity linchpin - VERIFIED via production precedent + empirical harness

The reactive linchpin (closure `$state<HTMLElement | null>` inside a module-singleton getter, read inside a `$derived` in an ancestor component, tracks when a descendant writes) is VERIFIED two ways:

- **Production precedent.** `MobileTabBar.svelte:49` reads `const fractionalIndex = $derived(pager.active ? pager.fractionalIndex : urlIndex)` where `pager = getMobilePagerStore()` is reached via the module fallback (`mobile-pager.svelte.ts:89-120`). `Header.svelte:57-59,74` reads `pager.dragging` in a `$derived` from the same store; Header's title morph during gestures is the live empirical proof that a `$derived` reading a module-singleton getter tracks reactively when the writer is a descendant of the reader. `getActiveGestureTrack()` has the identical reactive shape.
- **Empirical harness (Auditor #3).** A dev-server + chrome-devtools MCP harness against Svelte 5.56.3 confirmed `$derived(getActivePrimitive())` correctly tracked `null → el1 → el2 → null` through three writes via a module-singleton primitive-returning getter (the v2/v5 "stale null" was a harness artifact from synchronous `snap()` calls before flush; v4 with proper effect flushing showed correct per-phase values).

## Confirmed-still-holding (Round-1 fixes)

- **AppShell placement.** `+layout.svelte:308-314` wraps `children` in `<AppShell>` for every non-`/entry` route (`showShell` gate); AppShell is the sibling mounting point for the FAB layer, mirroring Header, surviving `(tabs)` ↔ top-level nav. Mobile-only via CSS (`md:hidden`), matching `Header.svelte:568,572`.
- **`fractionalIndex` signal (`backMorph` dropped).** `GesturePageLayout.svelte:340-359` returns early after `pager.set({..., backMorph: null})` when `centerTab !== undefined`; both thread routes pass `centerTab`. The continuous signal lives on `fractionalIndex` (line 353). `fab-routes.ts` evaluates `isOverlayRoute` before consulting the tab index.
- **A/B/C forward-nav taxonomy.** Family A (tab swipe/tap, MobileTabPager track) source at `MobileTabPager.svelte:347` + `switchTo:167-178`. Family B (thread enter/exit, GesturePageLayout track) source at `GesturePageLayout.svelte:240-249,258,869-873` (snapIndex 0→ACTIVE via rAF, CSS `transition-transform duration-200`), `bind:this={trackEl}:918`. Family C (compose, no pager) source at `/post/discussion/+page.svelte` and `/messages/new/+page.svelte` (no GesturePageLayout import).
- **OverlayLayer removal.** §3 rewritten against the real component graph; thread overlay = GesturePageLayout's center `.gpl-card`.

## Organic integration - CLEAN (all 5)

`git diff` gate (§7): `swipe.ts`, `GesturePageLayout.svelte` (R2-revised), `MobileTabPager.svelte` (R2-revised), `navigation-logic.ts`, `navigation.svelte.ts`, `tab-config.ts`, `scroll-chrome.svelte.ts`, `Header.svelte`, `MobileTabBar.svelte`, `(tabs)/+layout.svelte`, `DualColumnLayout.svelte`, `+layout.server.ts` contain **zero** FAB-named tokens. The two shared primitives that DO receive edits (`MobileTabPager.svelte`, `GesturePageLayout.svelte`) gain ONLY `bind:this` / declaration / publication / clear lines, no `fab` / `post` / `messages` / `discussions` strings. `AppShell.svelte` gains ONE render line. The root `+layout.svelte` gains ONE `initActiveGestureTrack();` call alongside the existing inits. The new module store `active-gesture-track.svelte.ts` is named for the gesture surface, paralleling `scroll-chrome.svelte.ts`.

## §9 carried items - ACCEPTABLE-DEFERRAL (all 5)

- **`$effect.pre` / plain-`$effect` empirical e2e gate.** The arm/disarm effect is plain `$effect` (not `.pre`), the prescribed mitigation per memory `svelte-effect-pre-same-flush-rerun`. The plan correctly does NOT assert static safety; it marks empirical e2e verification as an implementation gate (the "remove the guard, run the e2e sampler" prescription). All five auditors accept the deferral with the gate intact.
- **`size-14` owner-confirm-before-implementation.** FAB diameter `size-14` (56px) has no codebase precedent (`BookmarkButton.svelte:76` uses `btn-circle btn-sm`). Marked for designer confirmation before implementation; if a different diameter is specified, only the `size-*` class on the atom changes. Deferral acceptable because the rest of the plan is diameter-agnostic.
- **Fixed-viewport device-verify + portal fallback.** Reasoned via the Header existence proof (`Header.svelte:568,572` same AppShell DOM level, no drift under `html.fixed-viewport` `app.css:244-255`). The FAB at `position: fixed; z-35` sibling should behave the same. Portal to `document.body` is the noted fallback if a device test contradicts.

## Non-blocking concerns (carried to implementation, NOT re-audited)

- (a) **§4.8 Header citation technically imprecise.** Header is promoted sticky→fixed under `fixed-viewport` by the explicit `html.fixed-viewport header { position: fixed }` selector at `app.css:288-294`, not by generic sticky semantics. The conclusion still holds: `position: fixed` on html/body does not establish a containing block for fixed descendants, and there is no transformed ancestor between AppShell and the FAB, so the FAB anchors to the viewport.
- (b) **§4.5 "bind $effect" wording.** A NEW `$effect` must be added to `MobileTabPager.svelte` and `GesturePageLayout.svelte` (the latter can reuse its existing bind `$effect`). The §5 line count already accounts for this. The wording should be read as "an `$effect` that reads `trackEl` and calls `setActiveGestureTrack(trackEl)`", not as binding to an existing effect.
- (c) **§4.6 dragFraction writer under-specified.** The ternary `dragging ? dragFraction : samplerActive ? snapFraction` should read `dragFraction = tabFraction(pager.fractionalIndex, tabIndex)` during drag (the live store field is continuous during drag); the sampler writes only the snap phase's `snapFraction`.
- (d) **`MobileTabPager` has no `onDestroy` import today.** It uses `onMount` return-teardown (`:100-103`). The implementer should add `onDestroy` from `svelte` or reuse the `onMount` return-teardown pattern. Either path is acceptable; pick one explicitly.
- (e) **`getActiveGestureTrack()` SSR null-safety not stated.** During SSR `track === null` (no DOM), so the sampler is a no-op and the FAB renders at the path-predicate resting scale (1 on a list route, 0 on an overlay/compose route). Add this line to the plan or implementation notes; it is implicit in the design but not spelled out.
- (f) **Sampler stays armed on `/profile` routes.** No FAB renders on `/profile/*`, so the sampler consumes a minor rAF slot for nothing. Acceptable; the layer could short-circuit when no FAB is selected, but the wasted rAF is negligible.
- (g) **`isOverlayRoute` `/^\/messages\/\d/` future-route note.** A future `/messages/settings` would not match (deliberate per current route inventory). Document as intentional; revisit if a numeric-suffixed non-conversation messages route is added.

## Loop-exit statement

Loop exit condition met: 5/5 unconditional PASS. Plan approved for implementation. Implementation proceeds under `DV09-C00-Journal.md` + `RV09-C00-Audit-##` (per the DV08 pattern).

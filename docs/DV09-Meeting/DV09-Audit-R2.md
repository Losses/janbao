# DV09 - Audit Round 2

5 independent role-less auditors examined the revised `docs/DV09-Plan.md` against the codebase at `master` (`0a03874`). Result: **0/5 PASS** (all FAIL, high confidence). Each auditor returned the organic verdict `has-special-cases`. All Round-1 fixes (AppShell placement, `fractionalIndex` signal, A/B/C taxonomy, OverlayLayer removal, deferred items) were VERIFIED-FIXED. The single convergent Round-2 blocker is the `'activeGestureTrack'` Svelte context mechanism.

## Tally

| Auditor | Verdict | Blocking | Concerns | Organic           | Confidence |
| ------- | ------- | -------- | -------- | ----------------- | ---------- |
| 1       | FAIL    | 1        | 4        | has-special-cases | high       |
| 2       | FAIL    | 3        | 6        | has-special-cases | high       |
| 3       | FAIL    | 1        | 5        | has-special-cases | high       |
| 4       | FAIL    | 1        | 5        | has-special-cases | high       |
| 5       | FAIL    | 2        | 4        | has-special-cases | high       |

Result line: **0/5 PASS → revised.**

## Verified-FIXED from Round 1 (carry forward)

All five auditors independently confirmed the Round-1 fixes against source.

- **B1 placement FIXED.** `src/routes/+layout.svelte:308-314` wraps `children` in `<AppShell>` for every non-`/entry` route (`showShell` gate); `src/lib/components/templates/AppShell.svelte:56-59` renders `Header` + `<div class="app-shell-content">{children}</div>`, so a FAB layer rendered as a sibling of `Header` rides the same lifecycle and survives `(tabs)` ↔ top-level nav. The root layout initializes the pager/nav stores at module eval (`+layout.svelte:42-44`). The mobile-only gate is CSS (`md:hidden`), matching `Header.svelte:568,572` (no JS `isMobile`).
- **B2 signal FIXED.** `GesturePageLayout.svelte:340-359` returns early after `pager.set({..., backMorph: null})` when `centerTab !== undefined`; both thread routes pass `centerTab`. The continuous signal lives on `fractionalIndex` (line 353). `fab-routes.ts` predicates match: `isOverlayRoute` matches `/discussion/` and `/messages/<digit>`; the tab-index ambiguity (`tab-config.ts:35,47` — Discussions `isActive` accepts `/discussion/...`, Messages `isActive` accepts `/messages/...`) is resolved by evaluating `isOverlayRoute` before consulting the tab index.
- **A/B/C taxonomy VERIFIED for route shapes and tracks.** Family A source: `MobileTabPager.svelte:347` track div + `switchTo:167-178` + CSS `transition-transform duration-200`. Family B source: `GesturePageLayout.svelte:240-249` (`shouldAnimateEnter`), `:258` (snapIndex inits to 0 on mobile+entering), `:869-873` (single rAF flips snapIndex to ACTIVE), `:918` `bind:this={trackEl}`, track animates via CSS transition over 200ms. Family C source: `/post/discussion/+page.svelte` and `/messages/new/+page.svelte` import no GesturePageLayout. BUT the Family-B sampler input is unreachable from AppShell — see B1 below.
- **OverlayLayer removal FIXED.** Section 3 rewritten against the real component graph; thread overlay = GesturePageLayout center `.gpl-card`.
- **Deferred items FIXED.** `navigation.svelte.ts:103-105` exposes `pendingNav` and `:95-97` exposes `navInFlight`; `onDestroy` SSR teardown is `browser`-guarded (memory `svelte-ondestroy-runs-in-ssr`); fixed-viewport reasoned against `app.css:244-255` + AppShell root non-positioned; `size-14` owner-confirm pinned.

## The convergent Round-2 blocker

### B1 - `'activeGestureTrack'` Svelte context is directionally impossible (CRITICAL, 5/5)

§4.5 / §4.11 / §5 specified that `FloatingActionButtonLayer` (rendered by `AppShell`) reads `getContext('activeGestureTrack')` while `MobileTabPager` and `GesturePageLayout` (descendants of AppShell, mounted under the `(tabs)` / top-level route trees) write it via `setContext('activeGestureTrack', trackEl)`.

Svelte context flows parent → child only. Verified against source:

- `node_modules/svelte/types/index.d.ts:497` — `getContext` "will throw an error if no parent component called `set`".
- `node_modules/svelte/types/index.d.ts:503,512` — `getContext` "retrieves the context that belongs to the closest parent component" and "the context is then available to children of the component".
- `node_modules/svelte/src/internal/client/context.js` — `component_context` walks the `.parent` chain upward; a `getContext` call in AppShell cannot observe a `setContext` call made by a descendant component that has not yet mounted (and would not be on AppShell's parent chain even after it mounts).

The FAB layer in AppShell is an ANCESTOR of `MobileTabPager` / `GesturePageLayout`. `getContext('activeGestureTrack')` in AppShell returns `undefined` unconditionally. Every existing `setContext` in the repo is ancestor-owns: `+layout.svelte:118` (`app:lang`), `mobile-pager.svelte.ts:99,124` and `navigation.svelte.ts:274` (all three initialized from the root `+layout.svelte:42-44`). Zero precedent for descendant → ancestor context.

§9's fallback ("read via `getContext` on each `afterNavigate` tick") is the same broken call: even ignoring reactivity, `setContext` captures the value at call time, and the new route's `bind:this` fires AFTER `afterNavigate`, so the fallback sees null on the route it cares about.

**Fix (5/5 convergent, mandated by the existing pattern):** replace the context channel with a module-level reactive track store mirroring `mobile-pager.svelte.ts:89-120` (`globalMobilePagerFallback` + `window.__primaryPager`) and `navigation.svelte.ts:264-295` (`globalNavStoreFallback` + `window.__navStore`) — the SAME pattern that already makes the pager and nav stores reachable from AppShell without `getContext`. The track-owning descendants write the live `trackEl` into the module store; the FAB layer reads it in a tracked context (`$derived` / `$effect`) so the read re-runs when the bound track changes. The reactive `$state` inside the closure getter tracks exactly the way `getMobilePagerStore().fractionalIndex` tracks in a `$derived` (the getter reads the closure `$state`, Svelte's reactivity sees the read). The false "context reactivity" framing in §9 is removed.

### B2 - `MobileTabPager` has no `trackEl` to publish (HIGH, auditors 2, 5)

`grep -n 'bind:this' src/lib/components/templates/MobileTabPager.svelte` returns only `bind:this={deepPreviewEl}` (line 401). The track div (line 347, `<div class="flex w-[300%] ... transition-transform duration-200" style={trackStyle}>`) has NO `bind:this`, and there is no `trackEl` variable in the component. The track style is a derived string (`trackStyle:132-136`). The §4.5 / §4.11 claim of "ONE line: `setContext('activeGestureTrack', trackEl)`" is unimplementable as written.

`GesturePageLayout.svelte` is different: it already has `let trackEl = $state<HTMLElement | null>(null)` (line 250) and `bind:this={trackEl}` (line 918). The single publication line holds there.

**Fix:** `MobileTabPager` gains `let trackEl = $state<HTMLElement | null>(null)`, `bind:this={trackEl}` on the line-347 track div, `setActiveGestureTrack(trackEl)` in a bind `$effect`, and `clearActiveGestureTrack()` in `onDestroy`. Counted as the real edit (4 lines: declaration + bind + set + clear), not "one line". §4.11 and §5's "ONE line" claim is corrected for `MobileTabPager` (4 lines) and retained for `GesturePageLayout` (2 lines: set + clear; its `trackEl` already exists at line 250/918).

### B3 - "General capability" framing is post-hoc (HIGH, auditors 3, 5)

No plausible second consumer of `'activeGestureTrack'` exists. `GesturePageLayout.startPendingNavPoll:538-586` samples its own closure `trackEl`, never via a shared publication. `MobileTabPager` has no equivalent. The "any future analytics hook / edge-action" justification is speculative.

**Fix:** drop the "general capability" framing. State plainly: `MobileTabPager` and `GesturePageLayout` each gain a small, audited publication of their track element to a shared module store, solely consumed by the FAB sampler. The audit gate becomes "the diff to each shared primitive contains ONLY the `bind:this` / declaration / publication lines, with NO FAB-named tokens (no `fab`, `post`, `messages`, `discussions` strings) imported or referenced". Re-argue the DV08 "clean" criterion against this honest statement: clean = no feature-named tokens in shared primitives, not zero lines. Update §4.11 and §7.

## Secondary concerns (non-blocking but addressed in revision)

- **navInFlight gap (auditors 2, 5).** Cross-tab chip-exit contract = `navStore.pendingNav !== null || navStore.navInFlight`. Verified both exposed (`navigation.svelte.ts:95-97` getter `navInFlight`, `:103-105` getter `pendingNav`). `executePendingNav:194` clears `pendingNav` and sets `navInFlight = true` BEFORE `afterNavigate:131-137` clears it, so the `pendingNav !== null` clause alone misses the chip preload window. `GesturePageLayout.svelte:99-100,371-372` already uses the OR form — mirror it. The layer short-circuits scale → 0 DIRECTLY when this is true (not via `foregroundFraction`), because the source-list fraction is still 1 during a chip exit.
- **Single-frame retarget claim is false (auditor 2 B3).** Across a route swap, the old track unbinds (writer clears the store) and the new track binds (writer sets it) — NOT frame-synchronized. There is a no-track gap between old onDestroy and new bind. §4.3's "single-frame retarget, not a signal gap" is replaced with explicit sequencing: the sampler arms when the module store's track becomes non-null and disarms when it goes null; during the no-track gap the scale holds its last value (drag/snap mid-flight, route swap is not mid-gesture on the lost track) or snaps to the path-predicate default. Justified because a route swap that crosses the family A→B boundary does not happen mid-gesture (the gesture commits, then the route swaps).
- **§4.6 two-writer over-specified (auditor 2).** One track sampler feeds the sampled `fractionalIndex`; per-FAB scale = `clamp(2 · tabFraction(sampledFractionalIndex, tabIndex) − 1, 0, 1)`. Drop the per-surface store, or justify it precisely. Revision drops it.
- **`fractionalIndex` step-valued during snap (auditor 1).** Sampler still needed; Family-A/B snap is driven by the rAF reading the live transform, not by `fractionalIndex`.
- **`fixed-viewport` drift (auditors 1, 3, 4).** `Header.svelte:568,572` sits at the same AppShell DOM level, is `sticky z-40`, and does not drift under `html.fixed-viewport` (`app.css:244-255`). Existence proof for the FAB at `position: fixed; z-35` sibling. Portal to `document.body` is the noted fallback if a device test contradicts.
- **`size-14` (auditors 1, 3, 4, 5).** Owner-confirm kept but must resolve BEFORE plan approval; a wrong diameter ships as a visible regression.
- **`$effect.pre` same-flush re-run (auditor 5; memory `svelte-effect-pre-same-flush-rerun`).** The arm/disarm effect is plain `$effect` (not `.pre`); verify empirically it does not same-flush re-arm and strand a sampler. Marked UNVERIFIED — Round 3.
- **`isOverlayRoute` regex fragility (auditor 4).** `/^\/messages\/\d/` would fail a future `/messages/settings`. Acceptable for current route inventory; document as deliberate.
- **§6 case 2 back-from-compose (auditor 3).** Two separate 200ms transitions (compose→list, then list FAB fade-in), not one halved motion. Owned explicitly in revision.

## Verified-TRUE claims (carry forward)

`mobile-pager.svelte.ts:44-77` factory with closure `$state` + getter export; `:89-95` `globalMobilePagerFallback` + `window.__primaryPager` mirror; `:97-120` `initMobilePagerStore` sets context AND module fallback AND `window.__`. `navigation.svelte.ts:264-295` same shape (`globalNavStoreFallback` + `window.__navStore`). `+layout.svelte:42-44` is the init site for `navStore` + both pager stores (and will be the init site for the new track store). `MobileTabPager.svelte:347` track div lacks `bind:this`; `:401` binds `deepPreviewEl`. `GesturePageLayout.svelte:250,918` has `trackEl` + `bind:this`. `navigation.svelte.ts:95-105` exposes `navInFlight` + `pendingNav`. `GesturePageLayout.svelte:99-100,371-372` uses `pendingNav !== null || navInFlight`. `node_modules/svelte/types/index.d.ts:497,503,512` and `context.js` confirm parent → child only.

## Revision decisions

The Round-2 revision of `docs/DV09-Plan.md` applies the following changes, mapped to blocker IDs.

1. **Module-singleton track store.** [B1] Replace the `'activeGestureTrack'` Svelte context with a new module-level reactive store `src/lib/stores/active-gesture-track.svelte.ts` mirroring the `mobile-pager.svelte.ts:89-120` + `navigation.svelte.ts:264-295` pattern: closure `$state<HTMLElement | null>(null)`, `setActiveGestureTrack(el)` / `clearActiveGestureTrack()` writers, `getActiveGestureTrack()` getter, `initActiveGestureTrack()` invoked once from `+layout.svelte:42-44` alongside the existing inits. `MobileTabPager` and `GesturePageLayout` write the live `trackEl` into the store; the FAB layer reads it via `getActiveGestureTrack()` inside a `$derived` / `$effect`, so the read re-runs when the track changes. No `getContext` / `setContext`.
2. **Honest `MobileTabPager` trackEl edit.** [B2] Add `let trackEl = $state<HTMLElement | null>(null)` + `bind:this={trackEl}` on the line-347 track div + `setActiveGestureTrack(trackEl)` in the bind `$effect` + `clearActiveGestureTrack()` in `onDestroy`. Counted as 4 lines (declaration + bind + set + clear), not 1. `GesturePageLayout` adds only the set + clear lines (`trackEl` already exists at line 250/918).
3. **Retarget sequencing.** [B2 B3-concern] Replace the "single-frame retarget" claim with the real sequencing: the sampler arms when the store's track becomes non-null, disarms when it goes null; during the no-track gap the scale holds its last value (a route swap that crosses the family A→B boundary does not happen mid-gesture on the lost track; the gesture commits, then the route swaps).
4. **Own the shared-primitive impact honestly.** [B3] Drop the "general capability" framing. State the integration as an audited one-paragraph publication of the track element to a shared module store, solely consumed by the FAB sampler. Audit gate: the diff to each shared primitive contains ONLY `bind:this` / declaration / publication lines, with NO FAB-named tokens. Re-argue DV08 clean = no feature-named tokens, not zero lines.
5. **navInFlight fix.** [B1-concern / navInFlight gap] Cross-tab chip-exit contract = `navStore.pendingNav !== null || navStore.navInFlight`; the layer short-circuits scale → 0 directly (not via `foregroundFraction`).
6. **§4.6 simplification.** [B1-concern] One track sampler feeds the sampled `fractionalIndex`; per-FAB scale = `clamp(2 · tabFraction(sampledFractionalIndex, tabIndex) − 1, 0, 1)`. Drop the per-surface store.
7. **§9 UNVERIFIED items cleared.** Context reactivity is moot (replaced by a reactive module store). Fixed-viewport drift reasoned via Header existence proof, portal fallback noted. `size-14` owner-confirm must resolve before plan approval. `$effect.pre` same-flush re-run marked UNVERIFIED — Round 3.

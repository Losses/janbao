# DV16 - Compose-family FAB back-swipe follows the finger (coverProgress unification)

**Status:** Round 2 revised (Round 1: 3/5; Round 2: 1/5 → revised; `docs/DV16-Meeting/DV16-Audit-R1.md`, `docs/DV16-Meeting/DV16-Audit-R2.md`). Plan update history lives in `docs/DV16-Meeting/DV16-Plan-Journal.md`.
**Scope:** Mobile only (`max-width: 767px`), FAB scale during a drag back-swipe and during a cross-tab chip-exit. Desktop is unaffected (no FAB, no gesture).
**Related:** DV09 (`docs/DV09-Plan.md`) delivered the FAB and its three transition families; this is a corrective follow-up to one family. The defect's e2e regression spec is `e2e/fab-compose-backswipe.spec.ts`.

## 1. Goal

Make the FAB scale follow the finger during a drag back-swipe from a compose route (`/post/discussion`, `/messages/new`) toward its source list, identical to how the overlay family (thread, deep pages) and the list family (tab swipe) already behave. Today the FAB stays at scale 0 for the entire gesture and only appears after the route swaps to the list. The fix also closes the same-cause latent gap in which the FAB floats above a GesturePageLayout LoadingChip during a cross-tab chip-exit, by correcting the `coverProgress` signal the GPL publishes during a chip-exit.

The FAB appears over the last 50% of the gesture: `scale = clamp(2 · foregroundFraction − 1, 0, 1)`, so foregroundFraction must ramp 0 → 1 continuously with the finger for the scale to ramp over the second half.

## 2. Defect and evidence

**Symptom (reported).** Mobile: tap the FAB to enter the compose page; the FAB scales out with the forward nav (correct). Perform a drag back-swipe toward the list; the FAB does not scale in with the finger. It appears only after the route commits to the list.

**Location.** `src/lib/components/templates/FloatingActionButtonLayer.svelte`, the `foregroundFraction` derivation (line 372). The derivation branches on `cfg.family`:

- `list` reads the per-frame sampler (`tabFraction(sampledFractionalIndex, tabIndex)`, line 376-379).
- `overlay` reads the live `pager.coverProgress ?? 0` (line 388-390).
- `compose` returns the constant `0` (line 392-394), discarding `coverProgress`.

`scale = scaleFromFraction(foregroundFraction) = clamp(2 · foregroundFraction − 1, 0, 1)` (`src/lib/utils/fab-scale.ts:43`). With the compose branch pinned at 0, `scale` is 0 for the whole drag.

**Evidence (`e2e/fab-compose-backswipe.spec.ts`).** A per-frame `{scale, pathname}` probe across a CDP drag back-swipe `/post/discussion → /` records, on the current code:

- pre-swap (pathname `/post/discussion`): 40 frames, every one `scale = 0.00`.
- post-swap (pathname `/`): `0.00, 0.00, 0.13, 0.26, 0.38, 0.49, 0.59, 0.68, 0.77, 0.84, 0.91, 0.96, 0.99, 1.00` - the 200ms CSS ease runs only after the URL swaps.

The matching CALIBRATION test (overlay `/bookmarks → /`, same probe, same gesture) records the FAB scale rising above 0.3 while pathname is still `/bookmarks`. So the probe and the gesture surface are correct; the defect is isolated to the compose branch.

**Why prior coverage missed it.** `e2e/fab.spec.ts` "Family C back" (line 581-611) drives the back from compose via `page.goBack()` - a discrete browser-back eased by the atom's CSS transition, which never exercises the live gesture signal. `e2e/fab-deep-page-boundary.spec.ts` covers the drag back-swipe but only for overlay/deep routes. No existing spec drove a drag back-swipe from a compose route.

## 3. Architecture context (verified inventory)

### 3.1 Compose routes mount a GesturePageLayout

Both compose routes mount the same `GesturePageLayout` the overlay/deep routes do, with their source list as the left/back panel:

- `/post/discussion` renders `<GesturePageLayout centerTab={0} leftHref="/">` (`src/routes/post/discussion/+page.svelte:116`).
- `/messages/new` renders `<GesturePageLayout centerTab={2} leftHref="/messages/inbox">` (`src/lib/components/organisms/MessageCompose.svelte:119`, reached from `src/routes/messages/new/+page.svelte`).

### 3.2 GesturePageLayout publishes coverProgress on the centerTab branch

`src/lib/components/templates/GesturePageLayout.svelte`, the pager-publish `$effect` (line 339). When `centerTab !== undefined` (the thread/conversation/compose case), the branch at line 341-381 runs:

- During a drag (`dragOffset !== null`, swipe direction right): `cover = rawDragOffset / viewportWidth` (line 364), published as `coverProgress: cover` at line 379, with `dragging: true`.
- On commit (`committed`, drag released, nav pending): `cover = 1` (line 368), published at line 379.
- At rest: `cover = 0` (line 357), published at line 379.

The deep branch (`centerTab === undefined`, line 382-434) publishes `coverProgress` from the same shape: the raw drag fraction in the drag sub-branch (line 414), `1` in the committed sub-branch (line 423), `0` at rest (line 432).

### 3.3 The coverProgress store field, and its null vs 0 states

`src/lib/stores/mobile-pager.svelte.ts`: `coverProgress` is a closure-scoped `$state<number | null>(null)` (line 55) exposed through a reactive getter (line 82-84). The states:

- `null` on the server (the GPL `$effect` does not run server-side) and in the pre-mount SPA swap window.
- `0` at client rest once the GPL `$effect` flushes (the at-rest sub-branch publishes `cover: 0`).
- `0..1` during a live drag and `1` during the committed slide.

Only `GesturePageLayout` writes `coverProgress` (grep confirms; `MobileTabPager.svelte:103-108,140,141` never sets it, so the store's `set` (`mobile-pager.svelte.ts:63`) leaves it `null` on list routes). The FAB's `?? 0` fallback maps the server/pre-mount `null` and any off-GPL `null` to foregroundFraction 0.

### 3.4 The overlay family already consumes coverProgress correctly

`FloatingActionButtonLayer.svelte:388-390` reads `pager.coverProgress ?? 0` for the overlay family. The deep routes were folded into this read path during the earlier `fab-deep-page-boundary` work by giving them `fab: { family: 'overlay', kind: 'deep' }` (`src/lib/utils/route-config.ts:76-153`). The compose family retained its "discrete-only" design.

### 3.5 How the forward direction keeps working today (and must keep working)

Forward nav into a compose route is a tap (the FAB anchor), a discrete SvelteKit route swap with no drag. `coverProgress` is `null` (server / pre-mount) or `0` (client rest); foregroundFraction evaluates to 0 and `scale` targets 0. The atom's CSS transition (`transform 200ms ease-out`, `FloatingActionButton.svelte:94`, gated by the `fab-transition` class) eases the 1 → 0 swap. The class is armed by `transitionEnabled` (`FloatingActionButtonLayer.svelte:407-409`), which the `discreteNavInFlight` latch (`:82`, set in the `$effect.pre` at `:239-251` on any distinct family swap) holds across the route swap.

### 3.6 Route config for the compose family

`src/lib/utils/route-config.ts:164-173`:

```ts
{ pattern: /^\/post\/discussion$/, getParent: () => '/', fab: { family: 'compose', kind: 'discussions' } },
{ pattern: /^\/messages\/new$/, getParent: () => '/messages/inbox', fab: { family: 'compose', kind: 'messages' } },
```

`kind` is concrete, so `fabConfig` (`FloatingActionButtonLayer.svelte:116-181`) resolves a non-null config on a compose route and the atom stays mounted (the `{#if displayConfig !== null}` gate at line 419 keeps it in the DOM).

### 3.7 The coverProgress chip-exit bug (the latent gap, all GPL families)

A cross-tab chip-exit (a drawer/tab tap from a GPL route toward a different tab) routes through the GPL `beforeNavigate` chip-exit path (`GesturePageLayout.svelte:761-786`): `cancel()`, `swipeNeedsLoadingAtStart = true` (`:772`), `isPendingNavigation = true` (`:776`), then `preloadData(target).then(() => { isTransitioningOut = true; setPendingNav(target, type); ... })` (`:777-784`). The pager `$effect` reads `isPendingNavigation` into `committed` (`:345-348`) and, with `dragOffset === null`, publishes `coverProgress = 1` (`:368` centerTab, `:423` deep). This is true from the preload window (before `setPendingNav`) through the transition-out slide.

But during a chip-exit the source list is NOT revealed: the z-30 LoadingChip (`:1043-1063`, armed by `swipeNeedsLoadingAtStart && (isPendingNavigation || isTransitioningOut)`) stands in for the unmounted target page. Publishing `coverProgress = 1` ("list fully revealed") is therefore wrong for the signal's meaning. Every consumer of `coverProgress` (only the FAB, grep-confirmed) misreads it. For the overlay family this is latent today (overlay reads `coverProgress = 1` during the chip-exit and the FAB paints above the chip); for compose it is invisible today only because the constant-0 branch hides the FAB regardless. The §4.2 collapse removes that accidental hide, so the GPL must publish the correct value during a chip-exit (§4.6). `chipExitActive` (`FloatingActionButtonLayer.svelte:354-367`) is NOT the place to fix this: it is a consumer-side gate, and the chip-exit's preload window (`isPendingNavigation`, GPL-local `$state` at `:80`) is not exposed to the FAB layer.

## 4. Design

### 4.1 The invariant this defect violated

Every route that mounts a `GesturePageLayout` publishes a continuous `coverProgress` representing how much the source list is revealed. The FAB scale for any such route reads that signal so it follows the finger. The `list` family is exempt (pager routes; the Family A sampler reads the MobileTabPager track). The compose family is GPL-mounted, so it must read `coverProgress` exactly as overlay does - the constant-0 branch violated this. Separately, `coverProgress` must be `0` whenever a LoadingChip covers the content (a chip-exit does not reveal the source list); the GPL publishing `1` during a chip-exit violated this for every GPL family. DV16 fixes both at their source: the FAB layer reads `coverProgress` for overlay AND compose, and the GPL publishes `0` during a chip-exit.

### 4.2 The foregroundFraction fix (TypeScript-safe)

In `foregroundFraction` (`FloatingActionButtonLayer.svelte:372`), the `list` family keeps its sampler branch (unchanged). Everything else - `overlay` AND `compose` - unconditionally returns `pager.coverProgress ?? 0`:

```ts
const foregroundFraction = $derived.by(() => {
    const cfg = displayConfig;
    if (cfg === null) return 0;
    if (chipExitActive) return 0;                 // list-family MobileTabPager chip (unchanged)
    if (cfg.family === 'list') {
        // Family A sampler (unchanged).
        ...
        return tabFraction(...);
    }
    // overlay AND compose: both mount a GesturePageLayout that publishes
    // coverProgress during a drag. Read it live so the FAB follows the finger.
    // Resting (null server-side / pre-mount, 0 client-side) maps to 0; the
    // discrete forward/back swap is eased by the discreteNavInFlight CSS latch.
    return pager.coverProgress ?? 0;
});
```

The trailing constant-0 compose branch is removed; the unconditional final `return pager.coverProgress ?? 0` makes the return path exhaustive (TypeScript-safe). After the fix `foregroundFraction` has two signal sources: the Family A sampler (list), and `coverProgress` (overlay + compose). `chipExitActive` stays at its Round-0 list-only form (§4.7).

### 4.3 Why this is the structural fix, not a band-aid

The underlying cause (`cause`) is the compose branch's premise that compose routes have no continuous gesture signal. That premise is false: compose routes mount a `GesturePageLayout` and publish `coverProgress` identically to overlay routes. The structural fix removes the false premise by making compose read the same live signal overlay already reads. The companion cause - the GPL publishing `coverProgress = 1` during a chip-exit when the source list is not revealed - is fixed at the GPL source (§4.6), so the signal means what its consumers assume. Together they remove the FAB-layer family special-casing from the gesture-signal path (the list-only `chipExitActive` fallback stays because it handles a different chip - the MobileTabPager chip on list routes, which the GPL does not own).

All instances: the `foregroundFraction` compose branch is the only place a GPL-mounted family ignores `coverProgress` (grep confirms). Both compose routes flow through it. The chip-exit `coverProgress = 1` publication occurs in two GPL branches (centerTab + deep) and two sub-branches each (drag + committed); §4.6 gates all of them on `swipeNeedsLoadingAtStart`, closing the class for thread, deep, and compose routes.

Preventive test: `e2e/fab-compose-backswipe.spec.ts` drives a real CDP drag back-swipe and asserts the FAB scale rises above threshold AND passes through an intermediate value while the URL is still the compose route. A second test asserts the FAB stays at scale 0 across the full chip-exit window (preload + post-preload) using an uncached cross-tab target so the preload window paints. Both are tautology-resistant (resolved `getComputedStyle` samples keyed to the live pathname / the `.loading-overlay` DOM).

### 4.4 Interaction with the discrete-nav CSS latch and transitionEnabled

The forward tap into compose and the discrete back (`page.goBack()`, browser back) remain discrete navs. `coverProgress` is `null`/`0` throughout, foregroundFraction is 0, the family swap `list ↔ compose` trips `discreteNavInFlight` (`:239-251`), and `transitionEnabled` holds the atom's 200ms CSS ease. The `$effect.pre` trips on any distinct `fabConfig.family` transition; the fix does not change `fabConfig.family` for compose routes (`route-config.ts:167,172`), so the latch is identical pre- and post-fix. During a drag, `transitionEnabled = !pager.dragging && (...)` is false, so the CSS clock is off and the live `coverProgress` drives `scale`.

### 4.5 SSR and resting state

On the server and in the pre-mount SPA swap window, `pager.coverProgress` is `null`; once the destination GPL mounts it is `0` at rest. Either way foregroundFraction is 0 and the atom renders at `scale(0)`, `pointer-events-none`, `aria-hidden` (`FloatingActionButton.svelte:58`). No SSR change, no flash of scale 1 on a deep-linked compose page.

### 4.6 The coverProgress chip-exit fix (GPL source)

`coverProgress` semantically represents how much the source list is revealed. During a chip-exit (`swipeNeedsLoadingAtStart === true`) the source list is not revealed (a LoadingChip stands in for the unmounted target page), so the GPL must publish `coverProgress: 0`. The fix gates the published `coverProgress` on `swipeNeedsLoadingAtStart` in both branches of the pager `$effect` (`GesturePageLayout.svelte:339-434`):

- **centerTab branch (`:341-381`)** - in the drag sub-branch (`:358-365`) and the committed sub-branch (`:366-368`), publish `coverProgress: swipeNeedsLoadingAtStart ? 0 : cover` (where `cover` is the computed raw fraction / the commit `1`). The at-rest sub-branch (`:369-372`) already publishes `0`.
- **deep branch (`:382-434`)** - in the drag sub-branch (`:408-415`, `coverProgress: progress` at `:414`) and the committed sub-branch (`:416-424`, `coverProgress: 1` at `:423`), publish `coverProgress: swipeNeedsLoadingAtStart ? 0 : <value>`. The at-rest sub-branch (`:426-433`) already publishes `0`.

`swipeNeedsLoadingAtStart` is the GPL's existing chip-exit discriminator: it is set in `onSwipeMove` (`:509`, a drag toward an uncached or un-previewable target) and in `beforeNavigate` (`:772`, a cross-tab tap). It is `false` for a normal back-swipe toward a previewable source list (the target is cached and has a `previewPanel`), so those continue to publish the ramp / `1` and the FAB continues to follow the finger and rest at scale 1. It is `true` precisely when a LoadingChip covers the content, so the FAB reads `0` and hides.

This covers the preload window (B1): `swipeNeedsLoadingAtStart` is set in the same `beforeNavigate` path (`:772`) as `isPendingNavigation` (`:776`), before `preloadData` resolves, so the preload window publishes `0` too. It avoids the deep→deep misfire (B2): a deep→deep back-swipe (e.g. `/profile/edit → /profile/settings`) has `swipeNeedsLoadingAtStart === false` (the target has a `previewPanel`), so `coverProgress` ramps/`1` and the FAB scales in as before. It closes the overlay/thread latent chip-exit gap because both GPL branches are gated.

The change touches one shared primitive (`GesturePageLayout.svelte`) and injects no FAB-named tokens: `swipeNeedsLoadingAtStart` is a general GPL chip-exit concept, `coverProgress` is a general reveal-progress signal (its store docstring at `mobile-pager.svelte.ts:35-38` describes it as the overlay cover progress; the change corrects its value, not its meaning). The DV09 organic-clean gate ("no `fab`/`post`/`messages`/`discussions` tokens enter shared primitives") holds.

### 4.7 chipExitActive and organic integration

`chipExitActive` (`FloatingActionButtonLayer.svelte:354-367`) returns to its Round-0 list-only form. It still handles the MobileTabPager chip (a list-route cross-tab back-swipe or tap), which is a separate chip the GPL does not own; the `getCurrentTabIndex(pending.href) !== cfg.tabIndex` check is correct there because list-route pendingNav targets are tab roots. It is NOT extended to overlay/compose: with the §4.6 GPL fix, `coverProgress` is `0` during a GPL chip-exit, so the FAB reads the correct value directly and no consumer-side gate is needed.

Both changes (the `foregroundFraction` collapse in `FloatingActionButtonLayer.svelte`, and the `coverProgress` gating in `GesturePageLayout.svelte`) inject no FAB-named tokens into shared primitives. The §5 modified-files list enumerates the exact diff surface for each.

## 5. Files

**Modified:**

- `src/lib/components/templates/FloatingActionButtonLayer.svelte`:
  - `foregroundFraction` (`:372`): remove the compose constant-0 branch; `overlay` and `compose` both unconditionally `return pager.coverProgress ?? 0` after the `list` early-return (§4.2). Update the inline comment.
  - Refresh the inline comment at `:22-23` that claims `scaleFromFraction` maps foregroundFraction 1:1 over [0,1] (the actual map is `clamp(2·f − 1, 0, 1)`, the second half).
  - Refresh the file header block (`:15-39`) Family C description (compose reads `coverProgress` during a drag; the CSS transition handles only the discrete swap).
  - `chipExitActive` (`:354-367`) is unchanged (stays list-only).
- `src/lib/components/templates/GesturePageLayout.svelte`: in the pager `$effect` (`:339-434`), gate the published `coverProgress` on `swipeNeedsLoadingAtStart` in the centerTab branch drag/committed sub-branches (`:358-368`) and the deep branch drag/committed sub-branches (`:408-423`): publish `0` during a chip-exit, the computed value otherwise (§4.6). The at-rest sub-branches (`:369-372`, `:426-433`) are unchanged (already publish `0`). No `fractionalIndex` / `dragging` / `backMorph` / `targetIndex` change. No FAB-named token added.
- `src/lib/components/atoms/FloatingActionButton.svelte`: refresh the docstring at `:12-17` (Family C reads `coverProgress` during a drag; the CSS transition handles the discrete swap; correct the `transitionEnabled` formula reference at `:17`). No functional change.
- `src/lib/utils/fab-scale.ts`: refresh the `familyNeedsSamplerDuringDrag` docstring at `:64-75` (compose reads `coverProgress` directly, like overlay; not the sampler). The function body is unchanged (`family === 'list'`).
- `e2e/fab-compose-backswipe.spec.ts`: drop `test.fail` to `test` on the two DEFECT tests (discussions and messages compose back-swipe); add `preSwapIntermediateCount > 0` to both and to CALIBRATION; add a chip-exit test that asserts the FAB stays at scale 0 across the full chip-exit window (preload + post-preload) for `/post/discussion` against an uncached cross-tab target, keying the window on the `.loading-overlay` DOM (not on `pendingNav`). Refresh the doc comment.

**Unchanged (verification targets):** every shared primitive not listed above - `swipe.ts`, `tab-config.ts`, `mobile-tabs.ts`, `navigation-logic.ts`, `navigation.svelte.ts`, `scroll-chrome.svelte.ts`, `Header.svelte`, `MobileTabBar.svelte`, `(tabs)/+layout.svelte`, `DualColumnLayout.svelte`, `+layout.server.ts`, `app.css`, `MobileTabPager.svelte`, `route-config.ts`, `mobile-pager.svelte.ts`, `AppShell.svelte`, root `+layout.svelte`. `GesturePageLayout.svelte` receives only the `coverProgress` gating (no other logic change, no FAB token). `FloatingActionButton.svelte` and `fab-scale.ts` receive docstring touch-ups only.

## 6. Edge cases

1. **Drag back-swipe compose → list.** `coverProgress` ramps 0 → 1 (`swipeNeedsLoadingAtStart === false`, target cached); `scale = clamp(2·cover − 1, 0, 1)` ramps over the last half. Fixed.
2. **Forward tap list → compose.** Discrete nav, `coverProgress` null/0, `discreteNavInFlight` latches, CSS eases 1 → 0. Preserved.
3. **Discrete back compose → list (`page.goBack()`).** Discrete nav. The committed slide publishes `coverProgress = 1`, so the CSS ease runs DURING the slide (~200ms), matching the overlay family's timing: the compose foregroundFraction reads `coverProgress`, so the FAB ramps in across the slide rather than only after the swap.
4. **Deep-link to a compose route.** SSR/first paint: `coverProgress === null` → scale 0, `pointer-events-none`, `aria-hidden`. No flash. Preserved.
5. **Cross-tab chip-exit from a compose route (drawer/tab tap to a different tab).** `swipeNeedsLoadingAtStart` true throughout the preload + transition-out; the GPL publishes `coverProgress: 0`; the FAB reads 0 → scale 0 → hidden under the z-30 chip. Fixed (was latent for overlay; new-closed for compose). Covers both the preload window (`isPendingNavigation`, `pendingNav === null`) and the post-preload window.
6. **Cross-tab chip-exit from an overlay/thread/deep route.** Same as 5; both GPL branches are gated. Latent gap closed.
7. **Deep→deep back-swipe (`/profile/edit → /profile/settings`).** Target has a `previewPanel`, so `swipeNeedsLoadingAtStart === false`; `coverProgress` ramps/`1`; the FAB scales in. Unchanged (the Round-1 `chipExitActive` misfire is gone because the fix moved to the GPL source).
8. **Chip-exit drag on a deep route (back-swipe toward an uncached/non-previewable target).** `swipeNeedsLoadingAtStart === true` during the drag; the GPL publishes `coverProgress: 0`; the FAB stays hidden while the chip shows. Latent gap closed.
9. **Sampler arming.** The arm/disarm `$effect` (`:318`) arms only for `family === 'list'`. Compose/overlay never arm it. Unaffected.
10. **`effectiveKind` / `displayConfig`.** Key off `cfg.family === 'list'` (`:205-230`). Unaffected.
11. **Compose route at rest.** `coverProgress === 0` (client) / `null` (server) → scale 0. Atom mounted, invisible, non-interactive. Identical to today.
12. **retainedConfig fallback on a no-FAB-rule route.** `displayConfig` falls back to `retainedConfig` (`:194-230`). If the last FAB route was compose, `displayConfig.family === 'compose'` reads `coverProgress`. Those routes do not mount a publishing GPL, so `coverProgress` is `null` → foregroundFraction 0. Acknowledged dependency: `coverProgress` is `null` off any mounted GPL (MobileTabPager never writes it).
13. **GPL onMount cleanup nullifies `coverProgress`.** `GesturePageLayout.svelte:926` calls `pager.set({ fractionalIndex: 0, dragging: false, active: false, backMorph: null })` without a `coverProgress` field; the store's `set` (`mobile-pager.svelte.ts:63`) applies `coverProgress = update.coverProgress ?? null`, so `coverProgress` is reset to `null` synchronously at unmount. No stale window.
14. **Cancelled drag (finger reverses).** `dragOffset → null`, no `pendingNav`; the at-rest branch publishes `cover = 0` in one flush; `transitionEnabled` false; the FAB snaps down without a CSS ease. Matches overlay's pre-existing cancel behavior.

## 7. Testing plan

- **Unit (`bun test`).** No pure-function change (`fab-scale.ts` body, `route-config.ts` untouched). The existing `src/lib/utils/fab-scale.test.ts` and `src/lib/utils/fab-routes.test.ts` suites pass unchanged.
- **E2E (Playwright; NixOS gotchas - system chromium via `executablePath`, CDP touch not `page.mouse`, dedicated webServer port, `__navReady` / `__e2eGoto` gates, zombie-SW neuter):**
  - `e2e/fab-compose-backswipe.spec.ts`: CALIBRATION (overlay `/bookmarks → /`) stays green, gains `preSwapIntermediateCount > 0`; the two compose DEFECT tests flip to `test` and pass, asserting BOTH `maxPreSwapScale > 0.3` AND `preSwapIntermediateCount > 0`.
  - Chip-exit test (new): from `/post/discussion`, trigger a cross-tab chip-exit toward an UNCACHED target (cold-cache `/activity`) via `__e2eGoto`/drawer; the `{scale}` probe keys the chip-exit window on the `.loading-overlay` DOM presence (so the preload window is sampled, not just the post-`pendingNav` window); assert the FAB scale stays `< 0.1` for every frame the overlay is mounted. A second variant covers an overlay route (`/bookmarks` → cross-tab) for the same class.
  - `e2e/fab.spec.ts`, `e2e/fab-deep-page-boundary.spec.ts`, `e2e/fab-release-snap.spec.ts`, `e2e/fab-deep-real-interaction.spec.ts`: unchanged, still green (the `coverProgress` gating only fires when `swipeNeedsLoadingAtStart`, which is false for these specs' normal back-swipes and forward enters).
  - Full e2e suite (`bun run test:e2e`): no new failures beyond the pre-existing `header-tabs-replay` master flake.
- **Audit gates.** `git diff -- src/lib/components/templates/FloatingActionButtonLayer.svelte` shows ONLY: the `foregroundFraction` branch collapse + inline comment, the `:22-23` comment refresh, the header-block refresh. `chipExitActive` is unchanged. `git diff -- src/lib/components/templates/GesturePageLayout.svelte` shows ONLY the `coverProgress` gating on `swipeNeedsLoadingAtStart` in the centerTab and deep drag/committed sub-branches (no `fractionalIndex`/`dragging`/`backMorph`/`targetIndex` change, no FAB-named token). `git diff -- src/lib/components/atoms/FloatingActionButton.svelte` shows ONLY a docstring touch-up. `git diff -- src/lib/utils/fab-scale.ts` shows ONLY a docstring touch-up. `git diff` on every other shared primitive is empty. `git diff -- e2e/fab-compose-backswipe.spec.ts` shows ONLY the `test.fail` → `test` edits, the added assertions, the new chip-exit test, and the doc-comment refresh.
- **Quality gates.** `bun run check` 0 errors / 0 warnings. `bun run lint`: eslint 0 errors, similarity-ts type-duplicates 0 (the chain's non-zero exit on the pre-existing `src/app.css` prettier nit is unchanged). `bun test src/` passes.
- **Audit loop.** 5 independent open-ended auditors (no roles, no steering, read-only, no git mutation) examine the plan against the code; loop until 5/5 unconditional PASS (DV04 / DV09 pattern). Per-round verdicts: `docs/DV16-Meeting/DV16-Audit-RN.md`. Implementation proceeds under `docs/DV16-C00-Journal.md` + `docs/RV16-C00-Audit-NN.md`.

## 8. Out of scope

- **Unifying the two pagers' progress-signal contracts.** `MobileTabPager` publishes `fractionalIndex` that jumps to the integer destination on release (`MobileTabPager.svelte:140`), while `GesturePageLayout` publishes `coverProgress`. The Family A DOM sampler bridges that gap for the list family. Unifying the contracts (retiring the sampler) is a larger change on the tab-switch path, not required to fix this defect. Separate preventive follow-up.
- **Collapsing the `family` discriminant.** After §4.2 the `overlay` and `compose` branches of `foregroundFraction` are identical, but `family` still distinguishes compose for the `discreteNavInFlight` latch, `effectiveKind` / `displayConfig`, and the list-only `chipExitActive` fallback. Removing the `compose` value entirely touches logic outside this defect's surface. Out of scope.
- **Messages Family B e2e.** The pre-existing `/messages/[id]` 500 (`RV09-C00-Audit-07.md`) blocks a `/messages/inbox → /messages/[id]` trajectory spec. Unrelated to DV16.
- **Desktop FAB.** Desktop has no FAB and no gesture; unchanged.

## 9. UNVERIFIED items for Round 3

- **`coverProgress` gating correctness across the deep branch.** Static reading (§4.6): `swipeNeedsLoadingAtStart === false` for a normal deep back-swipe (target cached + has `previewPanel`), so `coverProgress` ramps/`1` and the existing `fab-deep-page-boundary.spec.ts` back-swipe assertion (scale reaches near 1) still holds. Round 3 to confirm no deep back-swipe path sets `swipeNeedsLoadingAtStart === true` when a real preview is showing.
- **Forward thread-enter / deep-enter unaffected.** Forward nav publishes `coverProgress` from the at-rest sub-branch (0) until a back-swipe begins; the gating only changes the drag/committed sub-branches, which a forward enter does not reach. Round 3 to confirm the `fab.spec.ts` Family B forward and `fab-deep-page-boundary.spec.ts` forward specs still pass.
- **Chip-exit e2e implementability.** Round 3 to confirm the `.loading-overlay`-keyed window captures the preload frame for an uncached target under the CDP-driven `__e2eGoto`/drawer trigger, and that `scale < 0.1` holds across it.

## 9.x Resolved (no longer UNVERIFIED)

- **`discreteNavInFlight` still trips on a `list ↔ compose` swap.** The `$effect.pre` (`FloatingActionButtonLayer.svelte:239-251`) trips on any distinct `fabConfig.family` transition; the fix does not change `fabConfig.family` for compose routes (`route-config.ts:167,172`). Empirically covered by `fab.spec.ts` Family C forward/back.
- **`/messages/new` parity.** `MessageCompose.svelte:119` (`centerTab={2}`) takes the same centerTab branch as `/post/discussion`; the DEFECT (messages) test is the empirical guard. Statically confirmed.

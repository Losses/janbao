# DV11 - Audit Round 9

5 independent role-less auditors examined `docs/DV11-Plan.md` (v9) under a clean open-ended prompt. Result: **not 5/5 PASS, but converging.** 3 PASS (auditors 1, 2, 4) / 2 FAIL (auditors 3, 5, both 0 blocking, 2 major each). The architecture, the ownership layer, the refcount, and the deletions are unanimously endorsed. The remaining gaps are two concrete correctness/specification items plus minor cleanups.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | PASS    | 0        | 1     | 3     | clean             |
| 2       | PASS    | 0        | 0     | 3     | clean             |
| 3       | FAIL    | 0        | 2     | 4     | has-special-cases |
| 4       | PASS    | 0        | 3     | 2     | has-special-cases |
| 5       | FAIL    | 0        | 2     | 4     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## Convergent findings (the two FAIL-drivers + endorsed majors)

### §6.4(b) "sample the container" is not observable (MAJOR, auditors 1, 3, 5)

`scrollChrome.containerEl` is a module-private `let` with NO public getter (`scroll-chrome.svelte.ts:79`). v9 §5 adds `releaseContainer` but no accessor, so the e2e cannot read the store's current container. Fix: rewrite §6.4(b) to assert the EFFECT (scroll the destination's active `.detail-scroll-pane` → the Header hide-on-scroll responds), which proves the container is the destination's panel without exposing store internals.

### Per-panel capture key disagrees with the root-layout capture on `/discussions/pN` (MAJOR, auditors 3, 5 - the real correctness gap)

The discussions tab href is `/`, but `/discussions/pN` is a real `(tabs)` route rendered inside the pager (`activeIndex` clamped to 0, `getCurrentTabIndex` returns −1 → fallback 0). v9 §4 keys the pager's per-panel capture by `MOBILE_TABS[i].href` (`/`), so while the URL is `/discussions/p2` the pager writes `pageScrollStore['/']` with the p2 scroll; the root-layout `beforeNavigate` (`+layout.svelte:65`) writes `pageScrollStore['/discussions/p2']` (`from.url.pathname`). Returning to `/` then restores the p2 scrollTop onto the p1 list - wrong page, wrong position. Fix: key the pager's per-panel capture AND restore by `page.url.pathname` (the live route), which matches the root capture and keeps `/` and `/discussions/pN` distinct.

### Specification/cleanup majors (auditors 1, 3, 4)

- **§6.1 de-tautologization underspecified.** Under the fix every panel's viewport `clientHeight` is screen height, so the existing `vpHeight === landed.vpHeight` assertions pass trivially. Specify the replacement: each section `clientHeight === viewport height` (full-height scroller) and the dest section's content is reachable by internal scroll (not clipped by a shorter viewport).
- **GPL `sync()` scroll-reset ambiguity.** v9 §5 says replace the `classList.add/remove` at `:866/877/911` with refcount calls, but doesn't state that the EXISTING `window.scrollTo(0,0)` + parent-scroll-reset inside `sync()`'s `if (isMobile)` branch STAYS. State: only the two `classList` lines become refcount `acquire`/`release` (behind the `held`-guard); the scroll-reset logic is unchanged.
- **HMR dispose.** `import.meta.hot?.dispose` resetting only the counter leaves `html.fixed-viewport` on `<html>` with counter 0 (or off with consumers still `held`). The dispose must ALSO `classList.remove('fixed-viewport')`; consumers re-acquire on their own remount (component-edit HMR), and a module-only HMR is a dev-only edge that re-converges on next nav.

### Minors (convergent)

- Stale "Sole setScrollContainer caller" comments (`GesturePageLayout.svelte:327`, `scroll-chrome.svelte.ts:40/81`) - the pager is now a second caller. Update them.
- Unused `getListScrollStore` import + `const listScroll` in the discussion page after removing `listScrollTop`.
- `app.css:322` `:not(:has(.mobile-tab-pager-viewport))` becomes redundant on mobile (the `:not(.fixed-viewport)` prefix already excludes tab routes); note it.
- `/search` override + `releaseContainer`: the self-heal relies on child-before-parent teardown for the override case; state the dependency (or keep GPL's cleanup unconditional for the override path - minor).
- `resetViewportScroll` deletion removes a defense-in-depth guard; no tab panel uses `scrollIntoView` today, safe, flag.

## Verified-TRUE facts carried forward (Round 9 additions)

- The refcount + per-caller `held`-guard + clamp-at-0 cover GPL's `mq`-driven resize-toggle AND the pager's mount/destroy, traced both mobile↔desktop directions, no double-count/underflow (auditors 1, 4, 5 traced).
- `releaseContainer(el)` self-heals for BOTH mount/destroy orderings during the `/`↔`/discussion` swap because the destination re-sets `containerEl` on mount (auditors 1, 2, 4, 5 traced both orderings).
- `setOverride` (SearchScopePager, `/search` only) never contends with the pager (sibling routes, never co-mounted) - the "unchanged" claim holds.
- `list-scroll.svelte.ts` is fully dead (`consume()` never called); deletion is safe; the snapshot-shape change (`listScrollTop === undefined`) is tolerated.
- The pager renders ONLY under `(tabs)` (the three tab roots); `/messages/[id]` and all deep routes use GPL - mutually exclusive, never co-mounted.
- `/discussions/pN` is a real `(tabs)` route in the pager at `activeIndex` 0; the discussions tab `isActive` covers `/` and `/discussion/*` but NOT `/discussions/pN` (so `getCurrentTabIndex` returns −1, clamped to 0) - the root of the key-mismatch.
- `getCurrentScrollY` first-match `.detail-scroll-pane` is unambiguous at steady state and in `beforeNavigate` (only source mounted); two exist only mid-swap.
- The height chain under `fixed-viewport` is unbroken; `overflow: clip` is not a scroll container; the `data-preview-tab` surface (`app.css:333-341`) pre-provides the flat-white tab styling (no `.gpl-card`).

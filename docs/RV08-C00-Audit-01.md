# RV08-C00 — Implementation Audit Round 01

Workflow `wf_10a2d3af-758`. 5 role-less full auditors (architecture + code quality) of the DV08 implementation vs `docs/DV08-Plan.md` + the diff. Result: **0/5 acceptable** (all `changes_requested`, high confidence). `organicIntegration` = **clean for all 5** (the shared primitives contain no `/search`/`scope` tokens or feature branches — verified by `git diff --stat` on the untouched targets being empty).

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence |
| ------- | ----------------- | -------- | -------- | ------- | ---------- |
| 1       | changes_requested | 1        | 4        | clean   | high       |
| 2       | changes_requested | 2        | 4        | clean   | high       |
| 3       | changes_requested | 1        | 4        | clean   | high       |
| 4       | changes_requested | 2        | 5        | clean   | high       |
| 5       | changes_requested | 1        | 4        | clean   | high       |

## Blocking issues (deduplicated)

**A — Desktop `/search` is broken (HIGH/CRITICAL, all 5).** `search/+page.svelte` mounts `<GesturePageLayout><SearchScopePager/></GesturePageLayout>` unconditionally on all viewports. On desktop this renders a 400%-wide 4-panel pager (`overflow:clip`, `height:100%` of an auto-height parent) with no form/scope/sort UI — the prior desktop form+select+scope-buttons+result-list was deleted in the same diff. Violates spec §1 ("Mobile only; Desktop `/search` unchanged"), edge #13, §8. (Note: the Header's desktop nav `hidden md:flex` still renders fine on desktop — the regression is the page BODY, not the App Bar.)

**B — Spec §7 tests missing (HIGH, 4/5).** No unit tests for `resolveHeaderMode`, the `(mode,morph)` layer table, `underline()` invariants, `createPagerStore()` two-instance independence, `normalizeSort`, `search-cache` `(scope,q,sort)` eviction; `swipe.test.ts` has no `shouldClaim`/`exclusive` coverage. The journal's "146 pass / 0 fail" is the pre-existing suite. The load-bearing boundary-handoff claim (§4.2) is asserted from code-reading only. `underline()` is inlined as `$derived.by` in `SearchTabBar.svelte` — structurally untestable; extract to a pure util.

## Notable concerns (non-blocking)

- `SearchTabBar` rendered as a separate row below the nav, not inside `searchLayer` as the spec table intends — flips at nav commit rather than riding the morph.
- Keyboard + `html.fixed-viewport` autofocus: `VisualViewport` `--avail-height` mitigation not wired (device-verify-gated).
- `activeIndex` init has no `isMobile` guard (cf. `4912122`); moot while desktop branch is absent, must be re-checked once added.

## Verified-clean (carry forward)

`git diff --stat` on `dao/search.ts`, `mobile-tabs.ts`, `navigation-logic.ts`, `navigation.svelte.ts`, `tab-config.ts`, `MobileTabBar.svelte` = empty. `swipe.ts` adds only the two general optional params + stop-prop on claimed moves (backward-compatible defaults). `GesturePageLayout.svelte` = mechanical `deepMorph→backMorph` rename + the single `override ?? centerEl` line. `scroll-chrome` = added `override`/`setOverride` (general). `mobile-pager` = clean factory (closure-scoped `$state`, two independent instances). `header-mode.ts` mirrors `deep-header-config`. Underline math numerically verified correct (0 violations over `f∈[0,3]`); `resolveHeaderMode`/`normalizeSort` hand-verified.

## Revision plan for Round 2

1. **Desktop branch** — extract the per-scope result rendering into a shared `SearchResultsList.svelte`; `SearchScopePager` renders 4 of them (mobile); add `DesktopSearch.svelte` (form + scope buttons + sort select + 1 active `SearchResultsList`); `+page.svelte` branches on `isMobile` (matchMedia sync like `(tabs)` layout). SearchScopePager becomes mobile-only.
2. **Extract `underline()`** to `src/lib/utils/search-underline.ts` (pure); `SearchTabBar` consumes it.
3. **Unit suite (§7)** — `header-mode.test.ts`, `search-underline.test.ts` (width≥c, ===c at integers, >c for t∈(0,1) both directions, t=0.5 edges), `mobile-pager.test.ts` (two-instance independence), `search-cache.test.ts` (`isFresh` eviction), `search/+page.server.test.ts` (`normalizeSort`); extend `swipe.test.ts` with `shouldClaim`/`exclusive` coverage (yield resets without capture/stop-prop; exclusive stops every claimed move, not pointerup/yield).

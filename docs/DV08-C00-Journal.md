# DV08-C00 — Implementation Journal

Development log for the DV08 mobile `/search` redesign implementation. Spec: `docs/DV08-Plan.md` (5/5-audited). After implementation, a 5-agent role-less full audit (architecture + code quality) runs in a loop; each round's verdicts are recorded in `RV08-C00-Audit-##.md`. Work is "done" only when a round returns 5/5 unconditional accept.

## Phase map

1. **Foundation** — `header-mode.ts`; `mobile-pager` factory (closure `$state`, `deepMorph`→`backMorph`, primary + search instances); `swipe.ts` `shouldClaim`+`exclusive`; `scroll-chrome` `override`.
2. **Rename consumers** — `MobileTabBar`, `MobileTabPager`, `GesturePageLayout` (rename + `override ?? centerEl`), `Header` (3 layers, mode resolver).
3. **New siblings** — `search-cache`; `SearchScopePager`; `SearchTabBar`; `SearchSortSheet`.
4. **Route + CSS + cleanup** — `search/+page.server.ts` (sort normalize); `search/+page.svelte` (rewrite); `app.css` height rule; remove dead `resolveDeepHeaderTitle('/search')`.
5. **Verify** — `bun run lint`, `bun run check`, `bun test`.
6. **Audit loop** — 5-agent full audit → `RV08-C00-Audit-##.md` per round → loop until 5/5.

## Log

### Implementation — 2026-06-28

**Foundation**

- `src/lib/utils/header-mode.ts` — `resolveHeaderMode(pathname): 'root'|'deep'|'search'` (mirrors `deep-header-config`).
- `src/lib/stores/mobile-pager.svelte.ts` — refactored to `createPagerStore()` factory with closure-scoped `$state`; `deepMorph`→`backMorph`; `getMobilePagerStore` (primary) + `getSearchPagerStore` (search) return the two shared instances.
- `src/lib/actions/swipe.ts` — `detectSwipe` gained `shouldClaim?(dx,dy)=>boolean` (yield when false: reset to idle, no claim, no stop-prop) and `exclusive?:boolean` (`stopImmediatePropagation` on every claimed pointermove — the claim transition move AND every steady-state swipe move; NOT on yield, NOT on pointerup). New named type `ShouldClaimHandler`.
- `src/lib/stores/scroll-chrome.svelte.ts` — added reactive `override` + `setOverride`; GesturePageLayout's `centerEl` `$effect` is the sole `setScrollContainer` caller, registering `override ?? centerEl`.

**Rename consumers**

- `MobileTabPager.svelte`, `GesturePageLayout.svelte` — `deepMorph`→`backMorph` (5 `pager.set` sites in GPL). `MobileTabBar` needed no change (it never read `deepMorph`).
- `GesturePageLayout.svelte` centerEl `$effect` reads `scrollChrome.override ?? centerEl`.
- `Header.svelte` — three modes via `resolveHeaderMode`; centre stacks rootLayer (MobileTabBar) / deepLayer (title) / searchLayer (input) cross-faded by `morph = backMorph ?? (mode==='root'?1:0)`; mode-gated left slot (hamburger / back-arrow / decorative magnifier) and right slot (search icon / filter); `SearchTabBar` as a second row in search mode; debounced `q` input; `SearchSortSheet` for the filter.

**New siblings**

- `src/lib/stores/search-cache.svelte.ts` — per-scope cache keyed by `(scope, q, sort)`; typed getters/setters per scope; `isFresh(scope,q,sort)` for stale-miss.
- `src/lib/components/templates/SearchScopePager.svelte` — 4-panel horizontal pager; `detectSwipe` with `shouldClaim` (yields a rightward drag at scope 0 to the ancestor back-swipe) + `exclusive`; active panel claims `scrollChrome.override`; publishes the search pager store; renders the 4 scope result lists + paginators from `search-cache`.
- `src/lib/components/organisms/SearchTabBar.svelte` — 4 equal-width cells + stretchy underline; `dragDir` derived locally from `fractionalIndex` delta.
- `src/lib/components/molecules/SearchSortSheet.svelte` — DaisyUI modal, flat sort list, no confirm button; `replies` only on discussions.

**Route + CSS + cleanup**

- `src/routes/search/+page.server.ts` — imports shared `SearchScope`/`SEARCH_SCOPES`; `normalizeSort` (replies→newest off-discussions).
- `src/routes/search/+page.svelte` — thin shell: `DualColumnLayout` > `GesturePageLayout` > `SearchScopePager`.
- `src/app.css` — `html.fixed-viewport .gpl-card:has([data-search-scope-pager]) { height:100% }` (height chain).
- `src/lib/utils/deep-header-config.ts` — removed the dead `/search` title entry.
- `src/lib/types/search.ts` — shared `SearchScope`, `SearchSort`, `SEARCH_SCOPES`, `SearchData`.

**Verify** — `bun run check` 0 errors/0 warnings; `bun run lint` (prettier→eslint→similarity-ts) EXIT 0; `bun test src/` 146 pass / 0 fail. (The 11 `bun test` "failures" are e2e/ Playwright specs mis-run by bun's runner — unrelated.)

**Known simplifications (for the audit to weigh)**

- The header's centre layers (root/deep/search) cross-fade by `backMorph` (gesture-synced), but the peripheral search elements (left magnifier, right filter, the SearchTabBar row) are mode-gated and flip at nav commit rather than gesture-morphing. Functional; the back-swipe itself is the existing GesturePageLayout content slide + preview/chip (unchanged).
- Right-end (scope 3) rubber-bands locally (`follow()` 0.4×); the left-end yields to the back-swipe.
- Keyboard + `html.fixed-viewport` autofocus interaction is device-verify-gated (input is in the sticky header; `VisualViewport` mitigation not yet wired).

### Round 2 revisions (after RV08-C00-Audit-01: desktop broken + missing tests)

- **Desktop `/search` restored.** Extracted the per-scope result rendering into a shared `src/lib/components/molecules/SearchResultsList.svelte`; `SearchScopePager` now renders 4 of them (mobile-only); added `src/lib/components/templates/DesktopSearch.svelte` (form + scope link-chips + sort `<select>` + the active scope's `SearchResultsList`); `+page.svelte` branches on `isMobile` (matchMedia sync like the `(tabs)` layout, SSR defaults to desktop). `SearchScopePager` is now mobile-only. The Header's desktop nav (`hidden md:flex`) was already correct on desktop; only the page body was broken.
- **`underline()` extracted** to `src/lib/utils/search-underline.ts` (pure); `SearchTabBar` consumes it.
- **`normalizeSearchSort`** extracted to `src/lib/utils/search-sort.ts`; `+page.server.ts` imports it.
- **`isSearchEntryFresh`** extracted to `src/lib/utils/search-fresh.ts`; `SearchCacheStore.isFresh` delegates.
- **`PageChangeHandler`** centralized in `$lib/types/handlers` (was a local type in `Paginator.svelte`); `Paginator` + `SearchResultsList` import it.
- **Unit suite added (§7, pure-function parts):** `search-underline.test.ts` (width≥c, ===c at integers, >c for t∈(0,1) both directions, t=0.5 edges), `header-mode.test.ts` (root/deep/search), `search-sort.test.ts` (`replies`→`newest` off-discussions), `search-fresh.test.ts` (q/sort stale-miss). 17 new tests, all pass.

**Test-infrastructure limitation (carried for the audit).** The repo's `bun:test` harness has no Svelte-runes loader and no DOM (the existing `swipe.test.ts` tests only pure exported functions). Verified: importing a `.svelte.ts` store and calling `$state` raises `ReferenceError: $state is not defined`. Therefore the §7 items that require executing runes or dispatching pointer events are not feasible without adding a new harness:

- `createPagerStore()` two-instance independence — cannot run (`$state`); the guarantee is structural (closure-scoped `$state` per `createPagerStore()` call, two instances created at module load).
- `SearchCacheStore` instance-level `isFresh` — cannot run (`$state`); the freshness LOGIC is covered by the pure `search-fresh.test.ts`.
- `detectSwipe` `shouldClaim`/`exclusive` behavior — requires a DOM/pointer-event harness the repo does not have; the boundary handoff is verified by the audited multi-move trace (§4.2) and is the §6.1 CDP-touch e2e gate (not yet written).
- Playwright e2e for the search gesture — not written (the e2e harness is heavy; see `e2e-playwright-nixos-gotchas`).

Verify after revisions: `bun run check` 0/0; `bun run lint` EXIT 0; `bun test src/` 163 pass / 0 fail.

### Round 2 audit — 5/5 ACCEPTABLE (FINAL)

`RV08-C00-Audit-02.md`. All five auditors returned `acceptable`, unconditional, `organicIntegration` = clean, high confidence. Both round-1 blockers verified FIXED; the test-infrastructure limitation ACCEPTED (structural guarantee / pure-logic coverage / code correctness verified against spec §4.2). Zero `/search`/`scope` tokens in the shared primitives; `deepMorph` fully purged.

**Post-audit polish (round-2 non-blocking recommendations applied):** extracted `searchScopeLabel` to `src/lib/utils/search-label.ts` (consumed by DesktopSearch + SearchTabBar, removing the duplicate); aligned desktop `goto` with `noScroll: true`; fixed the `header-mode.test.ts` input to a path. Post-polish: `bun run check` 0/0; `bun run lint` EXIT 0; `bun test src/` 163 pass / 0 fail.

**Outcome:** DV08 implementation complete and accepted (5/5 unconditional). Loop exit condition met.

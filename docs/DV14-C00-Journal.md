# DV14-C00 - Implementation Journal

## Phase map

- Plan: `docs/DV14-Plan.md` - 5/5 PASS over 2 rounds (`RV14-Plan-Audit-01`,
  `RV14-Plan-Audit-02`).
- Implementation: C00 (this cycle).
- Impl audit: `RV14-C00-Audit-NN`.

## Log

### Implementation - 2026-07-02

- `src/routes/+layout.svelte`: added `const listCache = getListCacheStore();` next to
  the other store consts, and added the cache-feeding `$effect` (gated on
  `isTabRootPath(page.url.pathname)`) alongside the badges seed effect.
- `src/routes/(tabs)/+layout.svelte`: removed the path-gated cache `$effect`, the
  `getListCacheStore` import, and the `listCache` const.

### Deviations from the plan

None. Implemented verbatim. The round-2 type-narrowing concern (auditors 2, 3) did
not materialize: `setDiscussions(page.data)` type-checks at root scope (the same
pattern the `(tabs)` effect used), so no cast was needed. `bun run check` is 0
errors / 0 warnings.

### Concurrent refactor (noted, not a deviation)

During the session, commit `73eafd9` ("refacor: Config unification") consolidated
`src/lib/utils/mobile-tabs.ts` into `src/lib/utils/route-config.ts`. `MOBILE_TABS`,
`getCurrentTabIndex`, and `TAB_LIST_PANELS` / `.panel` now live in `route-config.ts`
(`MOBILE_TABS` at line 361, `.panel` at 344/365). The plan's §3.2 citation
(`mobile-tabs.ts:48-52`) is therefore stale and was corrected. The fix's semantics
are unaffected: `MOBILE_TABS[tab].panel` still resolves to the same `Tab*Panel`
wrappers; `isTabRootPath` (`history-nav.ts:37`, depends on `tab-config`) and
`getListCacheStore` are unchanged.

### Test results

- `e2e/list-cache-stale-after-refresh.spec.ts`: 3/3 pass. Test 1 and Test 2 flipped
  green (all three caches now rewrite on a refresh, on a tab root AND on a deep
  page). Test 3 (post-refresh back-swipe navigation guard) stays green; its
  diagnostic still records `peak m41 = 0` (the secondary track-reveal anomaly, out
  of scope per plan §4.5).
- `bun run check`: 0 errors, 0 warnings.
- Full e2e suite: 163 passed, 3 failed, 2 did-not-run. The 3 failures are
  pre-existing OPEN defect-characterization specs unrelated to this change:
  `deep-to-deep-gesture-morph-spike` and `header-title-crossfade-clip` (×2). Both
  are documented OPEN defects (header-title-crossfade-clip-defect 2026-06-30; the
  deep-page gesture/morph family). This change touches only list-cache feeding
  (data layer) and cannot affect header title geometry or deep→deep gesture morph.

## Verify

- The fix is live: on a deep page, `invalidate('app:badges')` now rewrites all
  three list-cache slots (proven by Test 2 going green), so the swipe-back preview
  matches the landing.
- No regression in the cache/layout-touching specs (`tab-exit-preview`,
  `swipe-back-*`, `enter-animation`, `backtarget`, `tab-data-root-load` all pass).

## Concerns for RV14-C00 reviewers to scrutinize first

- Whether the `peak m41 = 0` track-reveal anomaly (Test 3) is truly independent of
  the cache fix, or whether the cache write's timing disturbs the GPL gesture. The
  expectation is no: the cache write is data-only, the track reveal is positional;
  but verify empirically.
- Whether the concurrent `mobile-tabs` → `route-config` consolidation changed any
  reader's `MOBILE_TABS[tab].panel` resolution in a way the fix misses.

## C00 Round-1 revision (post RV14-C00-Audit-01)

Impl audit: 5/5 PASS (one seat re-run as 3b after auditor 3 hit an API error).
Two non-blocking doc-accuracy cleanups adopted:

- Refreshed the stale setter-wrap comment in `src/routes/+layout.svelte` (it named
  the `(tabs)` layout as a caller; the current caller is the root-layout feeding
  effect).
- Renamed Test 1 and Test 2 titles to describe the fixed behaviour the bodies
  assert (all three caches rewrite), rather than the defect.

`bun run check` 0/0 and `e2e/list-cache-stale-after-refresh.spec.ts` 3/3
re-verified after the cleanups. No code-behaviour change. **DV14-C00 COMPLETE at
5/5.**

## Verify (final)

- The stale-preview defect is fixed: on a deep page, a refresh rewrites all three
  list-cache slots, so the swipe-back preview matches the landing (Test 2 green).
- No regression in the cache/layout-touching specs; full suite 163 pass with only
  pre-existing OPEN-defect characterization specs failing.
- The secondary post-refresh track-reveal anomaly (`peak m41 = 0`, Test 3) remains
  UNVERIFIED and out of scope; it is positional and independent of the data fix.

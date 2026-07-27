# RV21-C01 Audit 03 (R3)

**Date:** 2026-07-26. **Round:** R3. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0;
full e2e 218/0 (after the R2 sweep).

Both auditors BLOCKed and again confirmed the BEHAVIOUR is correct (no §5
violation, no snap, no CSS transition / setTimeout in the animation layer) and
the gates are green. All R3 findings are stale comments, a NEW class from R2:
the R2 sweep targeted the R1 morph-settle mechanism (`settleProgress` etc.) but
missed comments describing the Fix A publication surfaces, the Fix C
`tabProgress` / `searchProgress` / `HEADER_MORPH_THRESHOLD` refactor, and the
Fix B `/search -> tab-root` settle arm. R3-A also found that the R2 rewrite of
the `centerTab` docstring INTRODUCED a new inaccuracy (the rewrite claimed
thread routes are "deep, morph rests at 0, MobileTabBar hidden"; threads are
tab-associated routes where `currentHasTabs === true`, `morph === 1`, and the
bar is visible at rest). This is the recurring comment-sibling long tail; the
grep-phrasing sweeps keep missing classes and rewrites keep introducing errors.

## Findings (deduped across R3-A F1-F5 and R3-B F1-F4)

- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:251-256` (`centerTab`
  docstring): claims thread routes are deep with morph 0 / bar hidden; they are
  tab routes (morph 1, bar visible). Introduced by the R2 rewrite.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:3138-3160`
  (`notifyHeaderState` idle arm): claims `/search -> tab-root` discrete nav
  "deliberately does NOT arm the settle"; the discrete-nav branch DOES arm it
  (tab-ness changes), and the flash is prevented by `iconProgress`'s `isSearch`
  override, not by skipping the arm.
- `src/lib/utils/gesture-constants.ts:8-10` (`HEADER_MORPH_THRESHOLD`
  docstring): cites the eliminated formula `1 - min(1, morph / THRESHOLD)` over
  `[0, 0.2]`; Fix C changed `tabProgress` to derive from `searchProgress` over
  `[0.8, 1.0]`.
- `src/lib/stores/mobile-pager.svelte.ts:14-21` (`backMorph` contract):
  unqualified "null on tab roots, threads (centerTab routes)" is stale for the
  drag-time publication Fix A changed (non-null during a drag on those surfaces).
- `src/lib/components/templates/SearchScopePager.svelte:178-181`: the "only the
  NavPipelineHost back-swipe does" parenthetical excludes the other shapes that
  now publish `backMorph` (tab-host backward-to-deep, forward-to-`/search`,
  centerTab drag).
- `e2e/search-enter-exit-asymmetry.spec.ts:14-20, 188-191`: stale `[0, 0.2]` /
  `[0.2, 1]` bounds (Fix C made `tabProgress` non-zero over `[0.8, 1.0]`) and a
  reversed EXIT direction (`searchProgress` runs `1 -> 0` on EXIT, not `0 -> 1`).

**Severity:** concern each (code-comment accuracy in `.ts` / `.svelte` /
`.svelte.ts` / `.spec.ts`).

## Fix for R4 (CMA, comprehensive not grep-narrow)

The grep-phrasing approach has now missed two classes (R2 missed Fix C / Fix A;
R3 found them). This pass must READ every comment/docstring in each file the
cycle touched, against the current code, and fix every inaccuracy - not just
grep for known phrasings. Files: `src/lib/stores/nav-pipeline-orchestrator.svelte.ts`,
`src/lib/stores/mobile-pager.svelte.ts`, `src/lib/stores/nav-state-machine.svelte.ts`,
`src/lib/stores/scroll-chrome.svelte.ts`, `src/lib/components/organisms/Header.svelte`,
`src/lib/components/organisms/{MobileTabBar,SearchTabBar}.svelte`,
`src/lib/components/atoms/BurgerArrowIcon.svelte`,
`src/lib/components/templates/{NavPipelineHost,NavPipelineTabHost,SearchScopePager}.svelte`,
`src/lib/utils/{header-probe,gesture-constants,route-config,nav-resolvers}.ts`,
and the touched e2e specs. Each rewrite must be VERIFIED against the code (the
R2 rewrite of the centerTab docstring introduced a new error; do not repeat).

## Out-of-scope observations (nitpicks)

- Journal `.md` prose repeats the centerTab / morph-rests-at-0 inaccuracy.
  `.md`-only, nitpick.
- `bunx tsc -p e2e/tsconfig.json` reports 6 pre-existing errors in
  `fab-boundary-swipe-sync.spec.ts`, `messages-back-swipe.spec.ts`,
  `tab-click-transition.spec.ts` (pre-date this cycle on master). Not in the
  cycle's gate (which uses `scripts/tsconfig.json`). Recorded for a future cycle.

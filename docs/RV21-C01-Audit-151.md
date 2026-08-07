# RV21-C01 Audit 151 (R151)

**Date:** 2026-08-07. **Round:** R151. **Votes:** auditor A BLOCK (3),
auditor B BLOCK (1). **Counter after: 0/5.**

## Outcome

Four defects in different neighborhoods: em-dash in journal, RAW-publication
criterion target-only, resolver docstring overclaim, duplicate word. All fixed.

## A's findings (3 sites, all fixed)

- **F1 (BLOCK, gate failure):** Journal R150 entry contained a U+2014 em
  dash at line 8641. `bun run lint` exited 1. Fixed: replaced with `;`.
- **F2 (MEDIUM):** `mobile-pager.svelte.ts:25-27` RAW-publication criterion
  was target-only ("the target does not pill-map") instead of "not both
  endpoints resolve to a tab" (source OR target). Wrong for deep-page-source
  -> tab-target back-swipes (e.g. `/profile -> /` where source doesn't
  pill-map). Fixed: "not both endpoints resolve to a tab."
- **F3 (MEDIUM):** `nav-resolvers.ts:140-145` `ResolverInput.fromTabIndex`/
  `toTabIndex` docstrings overclaim strict tab-root ("or -1 when FROM/TO
  is not a tab root") where the orchestrator passes loose pill-map values.
  Fixed: "or -1 when FROM/TO has no tab association."

## B's finding (1 site, fixed)

- `e2e/search-enter-exit-asymmetry.spec.ts:60` duplicated word "descent
  descent" (pre-existing typo from DV17). Fixed: removed duplicate.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib` 552/0;
prettier clean; no U+2014 em-dash. Comment-only changes.

## Disposition

Counter after R151: 0/5.

**No git mutation.** No commits, no branches, no pushes.

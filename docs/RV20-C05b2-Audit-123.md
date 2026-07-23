# DV20 Cycle 5b2 - Audit 123 (R123)

**Date:** 2026-07-22. **Round:** R123, the twenty-first spec-scoped round.
**Counter after:** 0/5 (both auditors BLOCK). **Gate:** green (comment-only fixes;
R122's full e2e remains valid).

Both auditors voted BLOCK, each on a different class. Auditor A found a stale prose
reference in tab-config.ts to the mechanisms R122 deleted (a sibling the R122
horizontal check missed because it grepped identifiers, not conceptual phrasings
in sibling files). Auditor B found an rAF-ownership overclaim in
NavPipelineTabHost.svelte. Both fixed.

## A finding (1, fixed)

- **A1 (tab-config.ts:6-8, concern).** The header docstring claimed route-config.ts
  layers "the page-cache populated check, the list panel component, and the
  config-driven route->tab resolution". R122 deleted the first two (the
  MobileTab.checkCache / hasData fields and the TAB_LIST_PANELS / panel-component
  cluster); only the route->tab resolution remains. A prose sibling of the R122
  dead-code cluster, missed because R122's horizontal check grepped the removed
  identifiers and the route-config.ts comment site, not conceptual phrasings
  ("page-cache populated check", "browser-only bits", "list panel component") in
  sibling files that reference route-config. Fixed: the docstring now lists what
  route-config.ts actually layers (route->tab resolution, back-preview panels,
  route classifiers). The orchestrator's broad grep across the three conceptual
  phrasings confirmed tab-config.ts:6-8 was the only stale prose-reference site.

## B finding (1, fixed)

- **B1 (NavPipelineTabHost.svelte:352, concern).** The runPassthrough deferral
  comment overclaimed "the orchestrator's gesture-animation rAF": the gesture /
  commit-slide rAF is the executor's, and during a live drag no rAF runs
  (synchronous per pointermove). A sibling of the R122 SearchScopePager
  rAF-ownership-overclaim class. Fixed: the comment now says "the in-flight
  gesture / commit-slide animation" (names the animation without mis-attributing
  its rAF owner). The orchestrator's broad grep confirmed NavPipelineTabHost.svelte:352
  was the only overclaim site.

## Process note

R123 A1 exposed a gap in the R122 horizontal check: it grepped the removed
identifiers clean but missed a sibling file's prose reference to the removed
mechanism. Recorded in auto-memory (audit-search-for-similar-bugs): when removing
a mechanism, grep sibling files' docstrings for the conceptual description of that
mechanism (the nouns and phrases a reader would use to describe it), not only its
code identifiers.

## Out-of-scope observations (tracked, not fixed)

- `header-mode.ts:22-23` and `route-config.ts:166-168` carry "lands in a later
  cycle" / "Cycle 6 brings..." future markers (borderline; they describe current
  behaviour accurately and label the future work as future, not stale claims
  about present code). Tracked.

## Gate

check 0 errors / 0 warnings (1467 files); lint exit 0 (similarity informational;
type duplicates 0); prettier clean; no U+2014. Comment-only fixes; R122's full
e2e (210 passed / 0 flaky) remains valid. Counter 0/5 (both auditors BLOCK). R124
audits the fixed pipeline under the spec scope.

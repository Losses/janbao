# DV20 Cycle 5b2 - Audit 122 (R122)

**Date:** 2026-07-22. **Round:** R122, the twentieth spec-scoped round (the
would-be closing round at counter 4/5). **Counter after:** 0/5 (both auditors
BLOCK). **Gate:** green (substantive fix: dead-code deletion plus comment
rewrites; full e2e re-run).

R122 sat one PASS vote from closing the cycle (counter 4/5 after R120 and R121).
Both auditors voted BLOCK. Auditor A found a stale curve-attribution comment;
auditor B found a dead-code cluster (the first substantive, non-comment defect in
the R99 to R122 spec-scoped stretch) plus three stale comments. Per the model any
concern resets the counter; R122 resets to 0/5.

## A finding (1, fixed)

- **A1 (SearchScopePager.svelte:11-12 and :212-213, concern).** Both docstrings
  claimed the scope-switch rAF's `2u - u²` curve is "the same ease the
  orchestrator's commit / tap-scrub rAFs use". Wrong on two counts: the commit
  rAF is the executor's (not the orchestrator's), and the orchestrator's settle
  rAF also uses this curve and was omitted. The authoritative `commitEase`
  docstring (nav-executor-logic.ts:329-338) enumerates all three correctly. A
  sibling of the R110 to R121 rAF-ownership-overclaim class, missed because prior
  greps targeted the consumer-facing phrasings and not the SearchScopePager
  curve-reference phrasing. Fixed: both comments now point to the authoritative
  definition ("the pipeline's shared commit-ease curve; see `commitEase` in
  `nav-executor-logic.ts`") rather than re-enumerating the channels
  (drift-resistant). The orchestrator's broad grep confirmed these were the only
  two sites.

## B findings (4 plus horizontal-check extension, all fixed)

- **B1 (route-config.ts:228-232, concern).** The PREVIEW_PANEL_CONFIG header
  comment claimed a `MOBILE_TABS[activeTab].panel` fallback that does not exist
  (zero code reads; the field is dead). Fixed: the comment now describes the
  actual host fallback (the tab-root panel for a tab path, DeepPreviewSkeleton
  for an unmatched deep path).
- **B2 (route-config.ts:261-265, concern).** The `getPreviewPanel` docstring
  named the wrong consumer ("the FAB layer"; the actual callers are
  NavPipelineHost and NavPipelineTabHost) and the wrong fallback ("the active
  tab's panel"; the actual is the host's left-panel branch). Fixed to name the
  real callers and fallback.
- **B3 (NavPipelineHost.svelte:595-597, low).** The comment named the dead
  TabDiscussionsPanel and TabActivityPanel components as the landing tab page;
  the landing pages use DiscussionsPanel and ActivityPanel. Fixed to name the
  real components.
- **B4 (route-config.ts dead-code cluster, concern).** A whole dead cluster left
  over from an earlier panel-fallback design (a `MOBILE_TABS[activeTab].panel`
  lookup that no consumer ever read): the `MobileTab.panel`, `MobileTab.checkCache`,
  and `MobileTab.hasData` fields; the `TAB_LIST_PANELS` map; the two helper
  functions `tabListCached` and `tabListPopulated`; the two type aliases
  `CacheCheckFn` and `TabDataCheck`; the three panel-component imports
  (TabDiscussionsPanel, TabActivityPanel, TabMessagesPanel); and the three orphan
  component files of the same names. This is the same dead-preview-code class the
  spec's 5b1-skipped item #3 (remove dead ActivitySkeleton and DiscussionsSkeleton)
  was meant to clear; this cluster was missed. The orchestrator independently
  grep-verified zero code readers of every removed identifier (MOBILE_TABS entries
  are read only for `.href` and `.labelKey`; the removed fields, helpers, map, and
  panel components have zero code reads, only the now-fixed stale comments).
  Removed the full cluster; `MOBILE_TABS` is now `readonly TabDef[] = MOBILE_TAB_DEFS`
  (it adds nothing to MOBILE_TAB_DEFS once the dead fields are gone). `getPreviewPanel`
  and its unit tests are unchanged (live). Auditor B listed `checkCache` and
  `hasData` as out-of-scope; the orchestrator's horizontal check included them as
  same-class dead MobileTab fields (the user's binding: fix similar together), and
  removed the `+layout.server.ts:48` comment reference to `MobileTab.hasData`.

## Out-of-scope observations (B; tracked, not fixed)

- `header-mode.ts:22-23` "tag-only derivation lands in a later cycle" future
  marker (borderline; the resolver drives transition morph, but the at-rest mode
  is still `getCurrentTabIndex`-driven). B did not raise it as a finding;
  tracked.
- `route-config.ts:171-173` similar "tab-bar consumer resolves 'active' in a
  later cycle" future marker. Tracked.

## Gate

check 0 errors / 0 warnings (1467 files, down three from the deleted panel
component files); lint exit 0 (similarity informational; type duplicates 0);
prettier clean; no U+2014; unit 437 pass / 0 fail; FULL e2e 210 passed / 0 flaky
(9.2m, exit 0). This is the first round since R98 whose fix changed code (not
comment-only), so the full e2e was re-run rather than carried. Counter 0/5 (both
auditors BLOCK; the R120 and R121 votes reset). R123 audits the fixed pipeline
under the spec scope.

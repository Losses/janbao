# DV20 Cycle 5b2 - Audit 105 (R105)

**Date:** 2026-07-21. **Round:** R105, the third spec-scoped round. **Counter after:** 0/5 (both auditors BLOCK). **Gate:** green (comment-only fixes; R98's full e2e 210/0 stands).

Both auditors voted BLOCK. Combined 7 in-scope comment-accuracy concerns across 5 files, all in stale-consumer-reference and misattributed-publication-source classes.

## Findings and fixes

- **B1 (route-data.ts:44-50).** `RouteData.fab` docstring claimed "the resolver (Layer 3) reads the from/to fab booleans." Stale: the resolver does not read `RouteData.fab` (it returns only pageTrack + progressDirection + commitPhysics); the FAB layer reads it directly. Fixed: attributed to the FAB layer.
- **B2 (route-config.ts:48-50).** Sibling of B1: "the resolver reads only the core fab boolean." Fixed: removed the resolver claim.
- **B3 (route-data.ts:38-43).** `RouteData.snapshotCapture` docstring claimed "Read by the coordinator (Layer 4)." Stale: `nav-coordinator` is deleted; no code reads `snapshotCapture`. Fixed: field retained per spec Known #1 but has no production consumer.
- **B4 (route-data.ts:9-10).** Sibling of B3 (file-level header). Fixed.
- **B5 (route-data.ts:73-74).** "Cycle 2's unified PageCacheStore broadens this." PageCacheStore does not read `snapshotCapture`. Fixed.
- **A1 (SearchTabBar.svelte:17-19).** "the orchestrator's SEARCH-pager publication drives the underline position." Stale: the orchestrator does not write to the search pager; SearchScopePager's own rAF does. Fixed.
- **A2 (Header.svelte:268-269).** "The settle / tap-scrub fields come from the orchestrator's pager-store publication." Stale: settle fields are on NavStateMachine (orchestrator getters); only tap-scrub fields are in the pager store. Fixed: split the sources.

A comprehensive comment-cleanup fixer also found and fixed 3 sweep findings (NavPipelineHost:668-674 coordinator reference, page-cache.svelte.ts:29-36 + :133-135 Cycle-3 coordinator references). Total 10 comment fixes. check + lint green.

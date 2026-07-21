# DV20 Cycle 5b2 - Audit 99 (R99)

**Date:** 2026-07-21. **Round:** R99, the first spec-scoped round (the audit scope is now the DV20-C05b2 spec, not the whole repo). **Counter after this round:** 0/5 (R99 produced one in-scope concern; not a PASS round). **Gate:** green (check + lint pass for the fix; R98's full e2e 210/0 is unaffected by the comment-only change).

This is the first round under the spec scope the user directed. Two independent auditors examined the mobile navigation and page-transition animation pipeline against the DV20-C05b2 spec. Auditor A found one in-scope concern; Auditor B voted PASS (zero in-scope concerns). The orchestrator independently verified A's concern (it is real: a comment inaccuracy), fixed it, and re-verified.

## The convergence signal

Under the open scope (R91-R98) each round found many whole-repo defects (id-0, uploads, i18n, offline, dead code, transactions, etc.) and the counter never moved. Under the spec scope (R99), the navigation/animation pipeline is clean except for one stale comment. The spec scope is converging.

## Finding and fix

**C1 (A). `src/lib/utils/route-data.ts:76-78` ROUTE_ENTRIES docstring undercounts the `fab: true` routes.** The docstring said `fab` is true only on `/` and `/messages/inbox`, but the registry has `fab: true` on THREE routes: `/` (line 87), `/messages/inbox` (line 99), and `/discussions/p\d+` (line 109). The third entry's own inline comment (lines 104-105) explicitly states `fab: true` so the FAB is visible on every page of the discussions list, matching `/`. The sibling `FAB_ROUTE_ATTRIBUTES` registry in `route-config.ts` also lists all three. The docstring was the lone outlier. Fixed: the docstring now lists all three `fab: true` routes (`/`, `/messages/inbox`, `/discussions/p\d+`) with the within-tab-pagination rationale. Comment accuracy in a navigation `.ts` file is a concern, not a nitpick.

Auditor B read the same file and voted PASS without flagging the docstring; the orchestrator's independent re-read confirms A is correct (the docstring contradicted both the registry and the entry's own inline comment), so the concern stands and is fixed.

## Out-of-scope observations (noted by B, do not affect the vote, not fixed in this cycle)

1. The spec's Deliverables section names the journal `docs/DV20-C05b2-Journal.md`; the handoff document lives at `docs/DV20-Meeting/DV20-C05b2-Handoff.md`. Pure-prose nitpick.
2. `/offline/*` routes do not mount NavPipelineHost; this matches the spec's "Out of scope (5b3): Offline unification (Cycle 6)".
3. `route-data.ts` tags `/offline` and `/offline/activity` as `'tab'`; metadata for the future Cycle 6 unification, no effect on the C05b2 pipeline (the `isNavPipelineRoute` gate excludes them).

## Gate (orchestrator-run, 2026-07-21)

```
$ bun run check                       0 errors / 0 warnings (1470 files)
$ bun run lint                        EXIT=0 (similarity informational)
```

The fix is comment-only (no code or behavior change); R98's full e2e (210 passed / 0 flaky) remains valid. check and lint pass for the fix.

## Counter

0/5 (R99 had one in-scope concern; not a PASS round). R100 audits the fixed pipeline under the spec scope.

# RV20-C05b2 - Audit Round 66

Result: **A PASS-WITH-CONCERNS (2 CONCERN, both comment accuracy); B
PASS-WITH-CONCERNS (1 CONCERN, comment accuracy).** Counter stays **0/5**.
R66 is the cleanest round logically: **no logic bug, no state leak, no
architecture violation, no spec-code drift** in either auditor. All three
findings are docstring precision. All fixed.

## A's findings

1. **`OrchestratorPublication` docstring, FAB half stale (COMMENT, FIXED).** The
   docstring said the host's `$effect` publishes to the pager store "so the
   existing FAB / Header layers react." The Header consumes the pager store, but
   the FAB layer reads the orchestrator's publication DIRECTLY
   (`FloatingActionButtonLayer.svelte` derives `scale` from `publication.progress`
   - FROM/TO `RouteData.fab`). Reworded: the FAB reads the publication directly;
     the host publishes the macro + settle/scrub fields to the pager store for the
     Header.
2. **`releaseInputs` docstring "reads at-rest" overstates (COMMENT, FIXED).** The
   gap-frame publication's MACRO fields go at-rest (the `!#mounted` guard); the
   settle + tap-scrub micro-state stays live across the swap so the persistent
   Header keeps driving an in-flight settle/scrub. Reworded to qualify
   "macro fields" + note the live micro-state.

## B's finding

1. **Stale test comment referencing removed `plan.fab` (COMMENT, FIXED).**
   `nav-dom-driver-live.test.ts:184` "Mirrors `plan.fab` returning { scale: 0,
   translateY: 0, visible: false } for an inactive FAB plan in nav-resolvers.ts."
   The resolvers no longer carry `fab`/`header` fns (removed with `liveOffset` in
   R65 B2; the FAB/Header are reactive readers). Reworded to describe what the
   test does (drive the driver with a synthetic FAB visual at scale 0 + hidden).

## Both auditors verified clean

One transition mechanism; no animation-layer CSS transitions or `setTimeout`
(spec-excluded drawer snap + Header search debounce); state machine authority;
every clear-site correct (including the R60-R65 fixes); every sampled trajectory
(gesture commit/cancel, tab-click mid-transition, deep-to-deep, back-swipe,
forward enter, pointercancel, non-pipeline detour, host destroyed mid-drag,
mid-settle title revert, gesture commit to non-pipeline back-target,
`?search`-suffixed discrete nav, within-tab pagination) behaves per spec; no
U+2014 em dashes; all spec-removed identifiers gone.

## Gate outputs (post-fix, independently re-run 2026-07-17)

R66's fixes are comment-only (no runtime change); the e2e gate is unchanged from
the R65 post-fix run.

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 2 flaky (exit 0, R65 post-fix run; comment-only R66 changes)
```

R67 audits this state.

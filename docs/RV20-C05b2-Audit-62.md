# RV20-C05b2 - Audit Round 62

Result: **A PASS-WITH-CONCERNS (2 CONCERN); B PASS-WITH-CONCERNS (2 CONCERN).**
Counter stays **0/5**. R62 audited the post-R61-fix + `/discussions/pN`
migration tree. Both auditors verified the core pipeline clean (one transition
mechanism, no CSS transitions or `setTimeout` in the animation layer, the state
machine is the authority, every sampled trajectory clears correctly, the R60/R61
fixes hold). The four findings are two narrow logic fixes and two
comment/dead-code cleanups.

## B's findings

1. **`#armSettleEaseFromGesture` outgoing title snapped to empty on
   dynamic-title routes (LOGIC, FIXED).** The gesture-release settle arm read
   `resolveDeepHeaderTitle(inputs.fromPathname, t)` for the outgoing title, but
   the dynamic-title routes (`/profile/<id>/<slug>`, `/category/<slug>`,
   `/profile/discussions/<id>/<slug>`) carry their title in
   `page.data.headerTitle`, which `resolveDeepHeaderTitle` does not know. The
   Header's drag branch read the LIVE title, so at the drag-to-settle boundary
   the outgoing span snapped to `''` (a flicker on every sub-threshold cancel,
   and a disappear-on-release on commit). Fixed: the outgoing title is
   `#prevHeaderTitle` (the live title the idle settle-arm branch already uses),
   not the resolver.
2. **`#lastLandWasPipelineCommit` leaked past a gesture commit to a non-pipeline
   back-target (LOGIC, FIXED).** `#dispatchNav` set the flag unconditionally;
   for a non-pipeline target none of the three clear-sites fire (afterNavigate
   is gated on the orchestrator being active, which ends; `notifyHeaderState`'s
   main body is skipped on `!#mounted`; the supersede branch does not run), so
   the flag survived the detour and skipped the first tap-scrub on return to a
   pipeline route. Fixed: the flag is set only for a pipeline target
   (`isNavPipelineRoute(target)`); the docstring now states this.

## A's findings

1. **Inaccurate comment on the non-pipeline-destination branch (COMMENT + LOGIC,
   FIXED).** The R61 fix ended the in-flight eases on the
   `!isTabRootPath(to) && !isDeepToDeep` branch, but that branch also fires for
   a non-intercepted PIPELINE destination (e.g. `/search` from a tab/detail
   source), where the orchestrator stays active and `afterNavigate` clears the
   settle normally. The comment ("leaves the pipeline for a non-pipeline
   route") and the ease-end were both too broad. Fixed: the ease-end is gated
   on `!isNavPipelineRoute(to)` (only a genuine non-pipeline destination needs
   it), and the comment now describes both cases.
2. **Dead branch + stale docstring in `setNavPipelineOrchestrator` (CLEANUP,
   FIXED).** The displacing-unmount branch (`active !== orch`) cannot fire:
   every caller passes the singleton, so `active === orch` whenever both are
   non-null, and no test constructs a separate orchestrator. The docstring's
   "retained for the in-process test path" referenced a mechanism that does not
   exist. Fixed: the branch is removed; the docstring states the plain
   assignment. (`unmount` stays, called by the mobile -> desktop flip in both
   pipeline hosts.)

## Things both auditors verified clean

One transition mechanism (single `#progress` drives the slide + every reactive
reader); no CSS transitions or animation-layer `setTimeout` (the Header
search-debounce and the `swipe.ts` click-swallow safety net are not animation
alignment, both spec-permitted); the state machine is the sole authority; the
R60/R61 fixes hold (releaseInputs clears `#liveDragging`/`#prevWasDrag`; the
mid-settle revert ends an idle settle and keeps a commit settle's awaitTitle;
pointercancel forces cancel). Every sampled trajectory (gesture commit/cancel,
tab-click mid-transition, deep-to-deep, back-swipe, forward enter, pointercancel,
non-pipeline detour, host destroyed mid-drag, mid-settle title revert) clears
correctly.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    377 pass / 0 fail
$ bun run test:e2e                    201 passed + flaky (exit 0)
```

R63 audits this state.

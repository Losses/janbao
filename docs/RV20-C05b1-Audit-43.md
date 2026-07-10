# RV20-C05b1 - Audit Round 43 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (5); B FAIL (8). Both
auditors independently flagged the SAME chip-exit divergence (C1).

Both auditors were run with a clean, role-less, hint-less prompt (spec +
architecture + code + "find ANY defect empirically" + "search for
similar bugs before reporting"). Neither saw prior-round results.

## Consensus finding (both auditors, independently)

**C1 - chip-exit tab-click animation is observably different from GPL.**
`nav-pipeline-orchestrator.svelte.ts:940-994` (chip-exit branch) +
`NavPipelineHost.svelte` (`panelCount = $derived(chipExit ? 1 : 2)`,
`restingTranslateOverride = 0`).

GPL's tab-click chip-exit (`GesturePageLayout.svelte:788-812, 471-478`):
`isPendingNavigation` flips the track to `+maxDrag` (0.3 W) during the
preload wait, then `isTransitioningOut` CSS-transitions to `+W` - a two-
phase ~400ms animation. The new pipeline calls `executor.stop()`,
freezes the track at `tx=0` for the preload, then slides `0 -> W`
(single-phase 200ms).

**Orchestrator verification (read GPL directly):** CONFIRMED. GPL's
`trackTranslateX` derived (`GesturePageLayout.svelte:477-478`) is
`${swipeDirection === 'left' ? -maxDrag : maxDrag}px` while
`isPendingNavigation`, and `${... ? -W : W}px` while `isTransitioningOut`
(comment at `:571-574`). GPL does NOT freeze during preload.

**This overturns R42's B-C2.** R42 (and the Session 9 / Audit-42 docs)
claimed "GPL ALSO freezes the track during preload (`dragOffset = null`
before `preloadData`); executor.stop() matches GPL; NOT a behavior gap."
That cited the GESTURE-commit path (`dragOffset = null` at `:681`), not
the tab-click preload path (`:803`). GPL's tab-click chip-exit jumps to
`+maxDrag`. The "no movement during preload" IS a divergence. The
Session 9 / Audit-42 B-C2 text is corrected below.

**Classification note (architect decision pending):** the new chip-exit
design (`panelCount=1`, no sibling-panel slide) is architect-signed-off
in the Journal Design (`DV20-C05b1-Journal.md:253-263`: "track does not
slide to a sibling panel"). It SUPPRESSES GPL's wrong-list flash (GPL
reveals a MessagesPanel sliver during a `/` or `/activity` chip-exit);
the e2e `tab-exit-preview` ASSERTS `seenTabs: []` (no wrong list). So
the new behavior is an intentional improvement over GPL, but it is not
literally "indistinguishable" per the spec's binding bar. Whether to
(a) accept+document the divergence, or (b) replicate GPL's two-phase
chip-exit (re-introducing the wrong-list flash), is the architect's
call. It gates the chip-exit-tied fixes (B-C2 pager publication, A-C5
overlay smoothing).

## Auditor A concerns (PASS-WITH-CONCERNS)

- **A-C1** = the consensus chip-exit divergence (above). Adds: the non-
  chip-exit tab-click (pilot -> `/messages/inbox`) and the gesture back-
  swipe DO match GPL; chip-exit is the only divergent shape.
- **A-C2 (medium, behavior): portrait<->landscape resize during a cancel
  or forward-enter strands the track at a stale px transform.** The
  ResizeObserver re-applies `translateX(-50%)` only when
  `publication.plan === null`; during an in-flight transition it is
  skipped and `updateViewport` returns early. After the cancel settles,
  the at-rest `$effect` runs `updateViewport` + `resetPagerStore` but
  does NOT touch the track's inline transform; no new ResizeObserver
  event fires (size changed once). Track stranded at the driver's last
  px write (e.g. `-393px` while viewport is now 800px). Affects gesture
  cancel + forward-enter (the two at-rest-landing trajectories that
  don't navigate away).
- **A-C3 (low, state): stale `#chipExitPhase` when a gesture interrupts
  a chip-exit tab-click preload.** `#beginGesture` sets
  `#chipExitPhase='pending'` only when the gesture's `chipExit=true`;
  no `else` clear. Not visible (`chipVisible` reads `chipExitState`,
  correctly false), but violates the field's docstring ("Null at rest
  and after settle").
- **A-C4 (low, comment): `playEnterAnimation`'s hardcoded plan has
  fictional no-op FAB/Header functions; the docstring overclaims.** The
  pilot passes `fab: null, header: null`; the driver skips those
  branches; the real FAB/Header behavior comes from `coverProgress=0`
  (forced via `#isEnterAnimation`) + the FAB layer's own sampler.
- **A-C5 (low, behavior, chip-exit-tied): chip overlay width jumps at
  the pending->sliding boundary when a chip-exit interrupts a gesture
  commit.** `#commitStartRaw` (non-zero from the interrupted gesture)
  makes `slideProgress` jump in one frame (e.g. `0.3W -> 0.65W`).
  GPL smooths the same transition with a CSS `transition: width`; the
  pilot's overlay width is pure `$derived` (no transition). Narrow edge
  (tab-click during a ~200ms gesture commit).

## Auditor B concerns (FAIL)

- **B-C1** = the consensus chip-exit divergence (above). Adds the slide-
  distance point: GPL slides `maxDrag -> W` (0.7 W); the pilot slides
  `0 -> W` (full W).
- **B-C2 (medium, behavior, chip-exit-tied): pager store freezes during
  the chip-exit preload wait.** `#publish`/`#republishToPager` are not
  called while `executor.stop()` holds; the FAB/Header freeze at their
  last value for the preload window. GPL publishes continuously (its
  `$effect` reads `isPendingNavigation`/`isTransitioningOut`). (This is
  the real form of the mis-verified R42 B-C2.)
- **B-C3 (medium, behavior, latent): the gesture chip-exit fires
  `preloadData` in parallel and slides on commit regardless of preload
  state** (`:701-705`), unlike the tab-click path which awaits
  (`:988-990`). Latent because the pilot's backTarget (`/messages/inbox`)
  is always seeded/cached; if it were ever cold, the gesture chip-exit
  would slide-then-load (flash blank).
- **B-C4 (medium, comment): `#resolvePlan` inline comment under-
  describes** the chip-exit case (describes only the `panelCount=2`
  `-W -> 0` geometry; not the `restingTranslateOverride=0` `0 -> +W`
  chip-exit geometry).
- **B-C5 (low, comment): `#onExecutorTick` docstring has a stray stub
  sentence "Publishes a sample."** (merge artifact; the method returns
  void).
- **B-C6 (low, coverage): `messages-back-swipe.spec.ts` tests 5 (sub-
  threshold) and 6 (forward-enter) have weak assertions** (test 5 only
  `page.url` + `fabReversals`; test 6 only `samples.length > 3` +
  `|last-first| > 50`). A slide that never ran (URL changed via direct
  dispatch) would pass test 5.
- **B-C7 (low, coverage/dead-code): `nav-pipeline-pointer.ts
describeTarget` plumbs a `target`** through `lastDownTarget ->
ctx.target -> onPointerDown(x,y,target) -> IntentEvent.target`, but
  the classifier's `pointerdown` case discards it. Dead path for drags.
- **B-C8 (low, architecture): `#tabIndexFor` hardcodes
  `['/', '/activity', '/messages/inbox']`** instead of sourcing
  `MOBILE_TABS` (route-config.ts). A tab-set/order change silently
  desyncs `toTabIndex` (returns -1 -> broken pill interpolation).

## Classification + plan

- **C1 (both) + B-C2 + A-C5**: chip-exit family. Gated on the
  architect's C1 decision (accept+document vs replicate GPL). Fixed
  together once decided.
- **A-C2 (resize stale px)**: clear behavior bug, independent. FIX.
- **A-C3, A-C4, B-C4, B-C5**: comment/state accuracy, independent. FIX.
- **B-C6**: e2e coverage, independent. FIX (strengthen assertions).
- **B-C7, B-C8**: dead code + hardcoded tabs, independent. FIX.
- **B-C3**: latent gesture-preload. FIX (await, matching the tab-click
  path) or document as unreachable-for-the-pilot.

## Fixes landed (post-R43, for R44)

Owner C1 decision: the chip-exit must be smooth AND show no wrong list.
Literal GPL replication was rejected (it re-introduces GPL's ~70%-
viewport wrong-list flash). The fix is one design (not the rejected
trilemma):

- **slide-while-loading (C1 + B-C2 + A-C5 + B-C3):** the chip-exit slide
  starts immediately on tab-click (no `executor.stop()` freeze);
  `preloadData` runs in parallel; the commit-settle dispatch is gated on
  the preload resolving (`#chipExitPreload` + `#onExecutorSettle`) so the
  nav never lands on an unloaded target. `panelCount=1` keeps the chip
  covering the revealed area (`seenTabs: []`, no wrong-list flash); the
  chip grows with the slide (`chipRevealWidth = progress * vw`), stays
  opaque (no blank), unmounts on afterNavigate. The `onTick` publishes
  throughout (no pager freeze, B-C2); no pending/sliding phase split (no
  overlay jump, A-C5); the gesture chip-exit now also gates its dispatch
  (fixes B-C3's latent slide-then-load blank).
- **A-C2 (resize stale px):** the at-rest `$effect` re-applies
  `translateX(-50%)` after a transition settles, gated on `sawTransition`
  so it does NOT clobber the forward-enter seed (`translateX(0px)`) at
  mount.
- **A-C3:** removed `chipExitPhase` entirely (field + getter + sets); no
  phase split -> no stale phase.
- **A-C4:** documented the `playEnterAnimation` fab/header fns as
  interface placeholders (host passes null fab/header; real FAB/Header
  behaviour from `#isEnterAnimation` coverProgress=0 + centerTab
  backMorph=null).
- **B-C4:** `#resolvePlan` comment now describes both geometries
  (panelCount=2 `-W -> 0`; chip-exit panelCount=1 `0 -> +W`).
- **B-C5:** removed the stray "Publishes a sample." stub from
  `#onExecutorTick`'s docstring.
- **B-C6:** strengthened `messages-back-swipe` test 5 (`delta > 50` +
  `reversals === 0`) and test 6 (leftward `last - first < -50`).
- **B-C7:** removed the dead `target` plumbing (`describeTarget`,
  `lastDownTarget`, `PointerContext.target`, the `target` param on
  `forwardEvent` / `onPointerDown`).
- **B-C8:** `#tabIndexFor` sources `MOBILE_TABS` instead of a hardcoded
  array.

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    80 passed
```

Consecutive pass votes: **0** (R43 carried concerns; all 11 fixed; R44
audits post-fix).

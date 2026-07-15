# RV20-C05b2 - Audit Round 38

Result: **A PASS-WITH-CONCERNS (4 CONCERN + 2 nitpicks); B PASS-WITH-CONCERNS
(4 CONCERN).** Counter stays **0/5**. R38 found no logic defect: all eight
concerns are comment / docstring / dead-code / teardown-order accuracy, plus
stale spec text referencing the deleted family-swap mechanism. Independent
verification during triage surfaced a broader class of stale spec references
(the same deleted-mechanism wording in sections R37 had not swept), all fixed.
The FAB scale mechanism itself, the state-machine authority, the singleton
lifecycle, and the finish-then-new interruption policy are clean.

## A's findings (4 CONCERN, 2 nitpicks)

1. `orchestrator:1530` - the `#landAtRest` docstring "Return to at-rest without
   dispatching" is wrong: the method fires `goto(queuedNav.target)` when
   `#queuedDiscreteNav` is set (the finish-then-new policy). CONCERN.
2. `orchestrator:1461-1465` - the cancel-branch comment "return to rest
   without dispatching a nav" is wrong for the same reason (it calls
   `#landAtRest`). CONCERN.
3. `orchestrator:1552-1557` - the `setReplaceStateIntent(false)` comment's
   rationale ("a cancel-after-regrab returns to rest WITHOUT dispatching, no
   navigation lands") is wrong when a queued nav is present. CONCERN.
4. `FloatingActionButtonLayer.svelte:92` - `if (attrs.kind === null) return
null;` is unreachable: `FAB_ROUTE_ATTRIBUTES` never supplies a null kind.
   CONCERN (dead code).
5. nitpick `spec:204` - "the executor calls `onDragMove` -> `#publish()`" is
   backwards; the orchestrator calls `executor.onDragMove`, then `#publish`.
6. nitpick `spec:211-215` - "the same single transition progress" is a
   simplification; the FAB reads the raw drag progress while the page-track
   applies threshold absorption on non-bidirectional hosts.

## B's findings (4 CONCERN)

1. `nav-state-machine-logic.ts:39-41` - `TransitionSub` includes `'scrubbing'`,
   which no event produces (the root<->search tap-scrub runs as a direct-to-
   pager motion channel, not a transitioning sub); the comment listed it as a
   live peer. CONCERN.
2. `nav-executor-logic.ts:64-66` - the executor `'live'` docstring pairs the
   phase with "orchestrator sub `dragging` or `scrubbing`"; `scrubbing` is
   unreachable. CONCERN.
3. `gesture-constants.ts:29-31` - `TITLE_CROSSFADE_MS` names "Header.svelte
   unified title state machine" as the owner; the title crossfade is now owned
   by the orchestrator's settle / tap-scrub rAF eases (the Header is a reactive
   reader). CONCERN.
4. `NavPipelineTabHost.svelte:274-279` vs `NavPipelineHost.svelte:323-328` -
   the two sibling hosts tore down the orchestrator in opposite orders (TabHost
   released the singleton reference before releasing the inputs). CONCERN.

## Additional findings from orchestrator verification (spec, same stale class)

The spec still described the deleted family-swap mechanism as current in
sections R37 had not swept: the Scope (line 9), 5b1-skipped item #2 (line 21),
the unified-following-visual constraint (line 39), phased step 1 (line 48), the
"one rAF per motion channel" paragraph (lines 100-108: a deleted family-swap
rAF and a "cover-progress-driven FAB" the FAB layer never reads), the
configure / releaseInputs lifecycle (lines 118-122: `#lastRenderedScale` and
"arm the family-swap ease"), the §5 FAB-scale bullets (lines 208-215), and the
deliverable (line 366). All rewritten to the unified `fabScale(progress,
fromHasFab, toHasFab)` mechanism. `coverProgress` / `fractionalIndex` remain in
code and still drive the tab-bar pill anchor, so that reference was left.

## Fixes

- A1-A3: the three `#landAtRest` "without dispatching" comments rewritten to
  state that the method dispatches a queued finish-then-new discrete nav.
- A4: removed `null` from `FabRouteKind` and the local `FabKind` (both held an
  unreachable null) and deleted the two dead `kind === null` branches
  (`FloatingActionButtonLayer.svelte:92` and `:127`).
- B1: removed `'scrubbing'` from `TransitionSub`; fixed the type comment, the
  interrupt comment (`nav-state-machine-logic.ts:301`), and the test comment
  (`nav-state-machine-logic.test.ts:316`).
- B2: the executor `'live'` docstring now pairs the phase only with `dragging`.
- B3: `TITLE_CROSSFADE_MS` comment now names the orchestrator's settle / tap-
  scrub rAF eases as the owner.
- B4: `NavPipelineTabHost.releaseOrchestrator` reordered to match
  `NavPipelineHost` (release the inputs, then release the singleton reference).
- Spec: nine stale family-swap / cover-progress-FAB references rewritten to the
  unified `fabScale` mechanism; the §5 control-flow and progress wording
  corrected.

## Gate outputs (post-fix, independently re-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    201 passed + 2 flaky (exit 0)
```

Both flaky tests are the known CDP-touch class
(`fab-deep-real-interaction.spec.ts:191` and `fab.spec.ts:435`); each timed out
on its first touch-input attempt and passed on retry. The count matches the
pre-fix run, so the B4 teardown-order reorder introduced no regression.

R39 audits the post-R38-fix state.

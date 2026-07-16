# RV20-C05b2 - Audit Round 58

Result: **A PASS-WITH-CONCERNS (2 CONCERN); B PASS-WITH-CONCERNS (3 CONCERN).**
Counter stays **0/5**. R58 found one real logic bug (settle state leak in the
supersede branch) and four comment-accuracy issues. All five fixed. Both auditors
verified the architecture and all Known conditions are correct.

## A's findings (2 CONCERN)

1. `nav-state-machine.svelte.ts:180-183` `dispatch()` comment said "the reducer
   returns a fresh OrchestratorState" but the drag-move case returns the same
   reference. Fixed: reworded to acknowledge drag-move + explain why it's fine.
2. `orchestrator:520-534` `#lastLandWasPipelineCommit` docstring listed 2 clear
   sites; a 3rd exists in the supersede branch. Fixed: added the 3rd site.

## B's findings (3 CONCERN)

1. [LOGIC BUG] `orchestrator` supersede branch (lines 1688-1705): cleared
   `#queuedDiscreteNav` + `#lastDispatchWasDeepToDeep` + `#lastLandWasPipelineCommit`
   but NOT the settle ease state. When the in-flight goto was superseded by an
   external nav to a non-pipeline route, the settle rAF (armed with awaitTitle)
   held at u=1 indefinitely. The stale settleActive leaked to the next pipeline
   route, causing notifyHeaderState to snap instead of crossfade. Fixed: added
   `#endSettleEase()` to the supersede branch (the supersede path now clears ALL
   state: the queue, both flags, and the settle ease).
2. `orchestrator:5-9` docstring said afterNavigate is "gated by
   `isPilotTransition`" but it's gated only by `orchestrator !== null`. Fixed.
3. `route-config.ts:131,135` said "Family A: visible FAB at rest" but `/activity`
   has `fab: false` (atom at scale 0). Fixed: clarified only `/` and
   `/messages/inbox` show a visible FAB; `/activity`'s atom is mounted at scale 0
   for transition persistence.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    408 pass / 0 fail
$ bun run test:e2e                    199 passed + 4 flaky (exit 0)
```

The flaky tests are FAB-scale-sampler timing specs (pre-existing, unrelated to
these fixes).

R59 audits the post-R58-fix state.

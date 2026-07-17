# RV20-C05b2 - Audit Round 65

Result: **A PASS-WITH-CONCERNS (3 CONCERN); B PASS-WITH-CONCERNS (2 CONCERN + 2
nitpicks).** Counter stays **0/5**. R65 audited the post-R64 tree (the first
round where the prior tree had a clean auditor). Both auditors found real
defects: B1 is a bug introduced by the `/discussions/pN` migration (within-tab
pagination mis-classified as a tab-click exit, sliding a panel into empty
space); A1 is a supersede mis-fire on a gesture `history.back()` that lands on a
search-suffixed history entry. Plus the `liveOffset` dead state and four
docstring accuracies. All fixed; B1 is locked in by a new e2e.

## B's findings

1. **`/discussions/pN` -> `/` played an empty-panel slide (LOGIC, FIXED; bug
   introduced by the `/discussions/pN` migration).** The orchestrator's
   tab-click-exit classifier treated the within-tab pagination nav as a tab
   switch: `#isPipelineFrom` strips `/pN`, so `/discussions/pN` (host) and `/`
   (tab root) are different hosts, and the slide ran with no panel left of tab 0. Fixed: a same-tab guard (`getCurrentTabIndex(from) === getCurrentTabIndex(to)`,
   gated on `getRouteData(from).tag === 'tab'`) suppresses the slide for tab-
   internal pagination; a deep route that shares the tab's index
   (`/discussion/<id>` -> `/`) still slides. The first version (same-tab check
   without the tag gate) over-suppressed and broke 7 `tab-exit-preview` e2e
   (deep -> tab-root); the tag gate restores them. A new e2e
   (`discussions-pagination-no-slide.spec.ts`) locks the no-slide behavior in.
2. **`liveOffset` dead state in the executor (DEAD STATE, FIXED).** Computed
   every drag-move frame but never read: the plans carry no `fab`/`header`
   consumer fns (the FAB and Header are reactive readers of the orchestrator's
   publication per §5), so `buildVisual`'s `plan.fab?.(progress, liveOffset)` /
   `plan.header?.(...)` always short-circuited. Removed end-to-end
   (`ExecutorState`, `onDragMove`, `buildVisual`, the orchestrator's
   `onDragMove`/`onDragStart` args, the `FabPlanFn`/`HeaderPlanFn` signatures,
   the executor test, and three driver docstrings that still mentioned it).

## A's findings

1. **Supersede mis-fired on a gesture `history.back()` to a search-suffixed
   entry (LOGIC, FIXED).** `#dispatchTarget` is the gesture target's pathname
   (`pendingGesture.to`) or the discrete nav's full URL (`pendingDiscreteNav.target`
   = pathname + search), but the supersede re-entry match used `to + toSearch ===
#dispatchTarget`, so a gesture commit dispatched via `history.back()` that
   landed on a verbatim search-suffixed entry (e.g. `/?page=2`,
   `/messages/inbox?filter=unread`) did not match, falsely superseded, cleared
   `#lastLandWasPipelineCommit`, and armed a tap-scrub that should have been
   suppressed (a 200 ms search-panel slide-in-out). Fixed: a new
   `#isOwnDispatchReentry(to, toSearch)` helper accepts either a pathname match
   (gesture) or a full-URL match (discrete).
2. **`#lastLandWasPipelineCommit` docstring clear-site count (COMMENT, FIXED).**
   "Three places" missed `unmount` (four). Fixed.
3. **`#dispatchTarget` docstring (COMMENT, FIXED).** Claimed "pathname + search"
   unconditionally; it is pathname for gesture commits, full URL for discrete.
   Fixed (the helper's docstring states both forms).

## Nitpicks (B, FIXED)

`OrchestratorPublication` described `lastDispatchWasDeepToDeep` as "orchestrator-
private" (it is the cross-host handshake flag); `#lastLandWasPipelineCommit`
"only for a pipeline target" prose (the assignment is `isNavPipelineRoute(target)`,
true/false). Both reworded.

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 2 flaky (exit 0)
```

R66 audits this state.

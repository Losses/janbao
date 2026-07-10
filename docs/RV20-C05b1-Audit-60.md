# RV20-C05b1 - Audit Round 60 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (1 LOW); B PASS (clean, 3 LOW non-blocking).**
Zero MED/HIGH. Both auditors verified UNIFY (no bridge), no forbidden patterns
(no `setTimeout` / CSS `transition` / `transitionend` / `pendingNav` in the
pilot's path), the all-rAF executor, §9 coordinator-does-not-bypass, the
back-swipe / chip-exit / forward-enter geometry, the interrupt handoff, the
`coverProgress` continuity math, the skeleton migration, and comment accuracy.

Both auditors were run with a clean, role-less, non-leading prompt (spec +
architecture + code + "find ANY defect empirically" + "grep for the same bug
class in adjacent paths"). Neither saw prior-round results: the prompt
**explicitly forbade reading the Journal (`docs/DV20-C05b1-Journal.md`) and all
`docs/RV20-C05b1-Audit-*.md` files**, and allowed only `src/` + `e2e/` + the
spec + the plan (GPL readable as the behavior reference). The chip-exit was
evaluated against the spec's stated architect-approved divergence (End state
#1), not against literal GPL behavior.

## Pre-R60 fix audited by this round

- **C1 (search preservation, from the prior round's carry-over):**
  `onSvelteKitBeforeNavigate` dropped `navigation.to.url.search` (read pathname
  only), so a tab-click to a URL with a query string dispatched to the bare
  pathname. FIX: `toSearch` is now read alongside `to`; `#pendingTabExit.target`
  and the `#dispatchTarget` re-entry match carry the FULL URL (pathname + search);
  `goto` dispatches the full URL. `hopForHref` already strips `?search` internally
  (`pathnameOf`), so hop detection is unaffected.

## Concerns + fixes

- **A C1 (LOW) - `onSvelteKitAfterNavigate` truncated a forward-enter on a
  param-nav:** the method unconditionally called `#landAtRest()`. The layout's
  `afterNavigate` fires on every navigation, so a pilot-internal param navigation
  (`/messages/1` -> `/messages/2`) landing inside the forward-enter's ~200ms
  window called `#landAtRest` -> `executor.onLand()` (stops the rAF) + reset
  `#isEnterAnimation`, snapping the track to rest instead of completing the
  slide-in. GPL's enter (rAF + CSS `transition-transform`) is not cancellable by
  a param change, so this was a small divergence for a spec-required transition.
  Reachability is extremely narrow (the conversation page exposes no
  inter-conversation links; the user must use the URL bar, programmatic nav, or
  browser forward-back within the ~200ms window). FIX: guard
  `onSvelteKitAfterNavigate` with `if (this.#isEnterAnimation) return;` so a
  param-nav cannot cancel an in-flight enter; the enter settles on its own via
  `#onExecutorSettle` -> `#landAtRest` once the slide completes. Docstring
  rewritten to describe the guard. (No e2e added: the scenario is a sub-200ms
  timing race with no deterministic trigger in the conversation page, and the
  runes-based orchestrator cannot be unit-tested; the guard is the structural
  fix and the existing forward-enter e2e confirms no regression.)

- **B C1 (LOW, documented - not a defect):** the chip-exit skeleton branches
  (`<ActivitySkeleton>`, `<DiscussionsSkeleton>`) are unreachable today because
  `+layout.server.ts`'s `Promise.allSettled` returns truthy `EMPTY_*` objects on
  rejection, so `page.data.home` / `page.data.activity` are never null. The
  host's inline comment documents this accurately. The skeletons are the
  spec-mandated defensive fallback for a future non-eager-loaded target; the
  cached-panel path (the spec's primary chip-exit behavior) IS reached and IS
  covered by `tab-exit-preview.spec.ts`. No change.

- **B C2 (LOW, documented - correct pattern):** `pointerDisabled = $derived(() =>
!isMobile || trackEl === null)` yields a getter function value, which is
  correct for the Svelte action's `disabled: () => boolean` contract (the action
  calls `params.disabled()` each pointerdown and reads the current `$state`). An
  unusual but correct Svelte 5 pattern. No change.

- **B C3 (LOW, documented - safe):** `#mountInputs` is not cleared in `unmount()`.
  Safe because `unmountOrchestrator()` / `onDestroy` call
  `releaseNavPipelineOrchestrator(orchestrator)` (clearing the singleton) before
  / alongside `unmount()`, so no `beforeNavigate` reaches the unmounted
  orchestrator. A defensive `this.#mountInputs = null` would be cleaner but is
  not needed for correctness. Left as-is (not worth the churn for a non-defect).

## Documented as out-of-5b1-scope (carried from prior rounds)

- **C4 - the state machine is advisory, `#publication` is the authority:** the
  orchestrator feeds events to the state machine but does not read its state
  back; `#publication` is the actual source the host/driver consume. Plan §13.5
  ("the state machine is the only authority") is a DV20 cross-cycle goal. The
  5b1 End state requires only "the pipeline is the SOLE transition mechanism for
  the pilot route" (achieved); promoting the state machine to the single
  authority is 5b2+ work across all routes, not a 5b1 requirement. Documented
  here, not changed in this cycle.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0 (0 type duplicates; 56 similar-type pairs = historical baseline)
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- tab-click-transition tab-exit-preview messages-back-swipe fab    90 passed
```

Consecutive pass votes: **0** (A carried a LOW concern; fixed; R61 audits the
post-fix state).

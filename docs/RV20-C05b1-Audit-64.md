# RV20-C05b1 - Audit Round 64 (architect-run, 2 independent auditors)

Result: **A PASS (3 LOW, all non-defects); B PASS-WITH-CONCERNS (4 LOW, no
MED/HIGH - "approvable").** Zero HIGH/MED. Counter stays 0/5 (B's PWC).

Both auditors verified UNIFY (no bridge), no forbidden patterns (no `setTimeout`
/ CSS `transition` / `transitionend` / `pendingNav` in the pilot's path), the
all-rAF executor, §9 coordinator-does-not-bypass, the back-swipe / chip-exit /
forward-enter geometry, the interrupt handoff, the `coverProgress` continuity,
the re-entry guard, the commit/cancel gate, reduced-motion, and the
desktop-flip recovery. A additionally verified navStore convergence (the
two-phase cancel-then-dispatch reaches the same activeTab/stacks as GPL) and
that the Family-B FAB sampler reads the published `active-gesture-track` element
so the FAB ramps despite `coverProgress = 0`; B verified all six
`#chipExitState` / `#publication.chipExit` write sites stay in sync (Svelte 5
batches them in one flush). Both were run with a clean, role-less, non-leading
prompt that **explicitly forbade reading the Journal and all
`RV20-C05b1-Audit-*.md` files**; neither saw prior-round results.

## Concern + fix

- **B C1 (LOW) - chip-exit preview `paginate={false}` diverges from the landing
  tab page:** the chip-exit rendered `<DiscussionsPanel paginate={false}>` /
  `<ActivityPanel paginate={false}>`, but the real `/` and `/activity` routes
  mount `TabDiscussionsPanel` / `TabActivityPanel`, which wrap those panels with
  `paginate={true}`. So when the target tab has `totalPages > 1`, the chip-exit
  preview omitted the paginator that appears on landing - a visible (though
  seed-invisible, where `totalPages === 1`) divergence from the spec's "the REAL
  target panel slides in". FIX: both chip-exit preview panels now render
  `paginate={true}`, matching the landing tab page. (A did not flag this - it
  read the panel as the real target panel - but the paginator chrome is part of
  the landing page, so matching it is the faithful choice.)

## LOW findings (all documented NON-defects; no spec violation)

- **A C2 - chip-exit ActivityPanel preview instantiates `LexicalEditorLazy` for
  the ~200ms slide:** inherent to the spec's "the REAL target panel slides in"
  (the real ActivityPanel includes a composer), not a pilot deviation. The
  editor is disposed when the chip-exit panel unmounts. No change.
- **A C3 / B's note - `pointerDisabled = $derived(() => !isMobile || trackEl ===
null)`** is a redundant `$derived` whose value is the getter function
  (recurring): correct for the action's `disabled: () => boolean` contract; a
  plain `const` would behave identically. No change.
- **B C2 - state machine stuck in `transitioning` after a commit** (the C4 item,
  recurring): `#onExecutorSettle` dispatches but does not call
  `#stateMachine.onLand`; harmless because the orchestrator reads `#publication`
  (the authority), not the state machine's phase. §13.5 ("state machine is the
  only authority") is a cross-cycle goal, out of 5b1 scope. No change.
- **B C3 / A C1 - chip-exit skeleton branches unreachable** (recurring):
  documented dead code (eager-load always truthy); spec-mandated fallback for
  5b2+. No change.
- **B C4 - unreachable `{:else}` PreviewPanel fallback:** the pilot always passes
  the `left` snippet, so the `{:else} getPreviewPanel(leftHref)` branch is dead
  for the pilot. Defensive for a future pilot that omits `left`. No change.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- tab-click-transition tab-exit-preview messages-back-swipe fab    91 passed
```

Consecutive pass votes: **0** (B carried a LOW concern; the paginate divergence
fixed; R65 audits the post-fix state).

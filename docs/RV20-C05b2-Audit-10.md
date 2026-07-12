# RV20-C05b2 - Audit Round 10 (architect-run, 2 independent auditors)

Result: **A FAIL (1 HIGH + 1 MED-HIGH + 1 MED + 1 LOW); B PASS-WITH-CONCERNS
(1 LOW).** Counter stays 0/5.

A found a HIGH-severity 5b2 regression B missed (B did not read the Header
organism). Both verified the core pipeline clean.

## Fixed

- **A #1 (HIGH) - Header morph commit/cancel classification broken.** Real 5b2
  regression: the Header's release-settle state machine read
  `navStore.pendingNav !== null` to classify commit vs cancel, but the pipeline
  orchestrator dispatches `goto` directly and NEVER calls `setPendingNav`. So
  every pipeline gesture release was classified as cancel (settleTarget=0),
  making the morph retreat during commits then snap on land. FIX: added a
  `committed` signal to the pager store (`setCommitted(true/false/null)`); the
  orchestrator publishes it synchronously at release (commit→true, cancel→false)
  and clears it in `#landAtRest` (null). Header Effect B reads
  `pager.committed === true` (was `pendingNav !== null`); Effect D ends the
  settle when `pager.committed === null` (was `pendingNav === null && !inFlight`,
  both permanently dead signals). Verified: e2e 93+1flake (the flake passes
  alone).

## Carried (next fix round)

- **A #2 (MED-HIGH) - Header CSS transitions + setTimeout in the gesture/animation
  layer.** The Header morph/title animation uses `transition: transform 200ms` +
  `setTimeout` settle backstop, both §5-prohibited. Pre-existing (not a 5b2
  regression); the Header is a consumer of the gesture layer, not the core
  pipeline. Needs a Known condition (migrating the Header's animation to rAF is
  a DV20-wide goal beyond 5b2). Also: Header `runSettleDriver` has no
  `prefers-reduced-motion` gate (A #4, pre-existing).
- **A #3 (MED) - `playEnterAnimation` comment mis-describes the coverProgress
  mechanism.** Says `#isEnterAnimation forces coverProgress = 0`; actually
  coverProgress advances 0→1 during the enter. Comment inaccuracy.
- **B #1 (LOW) - NavPipelineHost `left` prop + discussion thread's `leftSnippet`
  are dead code.** The `{:else if left}` branch is unreachable (all tab roots
  intercepted by built-in branches). Docstring says "MessagesPanel for the
  pilot" but `/messages/[id]` doesn't pass `left`.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab tab-host-swipe tab-swipe-preview-height    93 passed, 1 flake (3.7m; the flake passes alone at 3.2s)
```

Consecutive pass votes: **0/5** (A FAIL + B PWC; the HIGH regression fixed +
verified; A #2/#3/#4 + B #1 carried). R11 audits the post-fix state.

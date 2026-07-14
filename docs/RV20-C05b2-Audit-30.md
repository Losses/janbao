# RV20-C05b2 - Audit Round 30

Result: **A PASS (zero concerns); B PASS-WITH-CONCERNS (1 CONCERN).** Counter
stays **0/5** (a clean round needs both auditors PASS). This is the first round
in which one auditor returned a clean PASS, and the only concern was a real
visible defect.

## A's verdict: PASS

A verified every end-state (route mounting, no CSS transition on the FAB atom,
NavStateMachine as sole authority, MobileTabPager / LoadingChip cross-tab overlay
gone, GPL/MTP deleted, the rename), the global animation manager (singleton +
configure/releaseInputs/unmount lifecycle, four orchestrator-owned rAF channels,
FAB/Header as reactive readers), the five Known conditions, no CSS transitions or
setTimeout in the gesture layer, comprehensive reduced-motion handling, and
comment accuracy. Zero concerns.

## B's finding

### B1 (CONCERN, medium, comment + visible defect) - forwardDeepTarget mis-fire

`NavPipelineHost.svelte` `forwardDeepTarget` fired for ANY non-tab-root
`transitionTarget`, but its docstring scoped it to "a detail -> detail push
intercepted by the orchestrator". `transitionTarget` is
`publication.inFlight ? publication.toPathname : null`, and `playEnterAnimation`
(a tab -> deep forward-enter) publishes `toPathname` = the deep destination
during the in-flight slide, so `forwardDeepTarget` fired for tab -> deep
forward-enters too. The left panel then rendered `DeepPreviewSkeleton` for
~150ms instead of the source's panel (e.g. tapping a conversation in
`/messages/inbox` flashed a generic skeleton over the inbox list during the
slide). The e2e missed it (the forward-enter specs sample only the track
transform, never the left-panel content).

Fixed: `forwardDeepTarget` now also requires the source (`resolvedLeftHref`) to
NOT be a tab root. A tab -> deep forward-enter (source is a tab root) falls
through to the `leftPanelPathname` branches and shows the source's panel; a
deep-to-deep intercept (source is a deep page) still reveals the destination
skeleton. The docstring is updated to state the condition.

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    409 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:430,
                                     the pre-existing CDP touch flake)
```

The forwardDeepTarget change is e2e-safe (forward-enter and deep-to-deep slides
pass unchanged; the left-panel content change is not asserted by the existing
specs). No behavioral regression.

R31 audits the post-R30-fix state.

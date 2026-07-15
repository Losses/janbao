# RV20-C05b2 - Audit Round 32

Result: **A PASS (zero concerns, 1 nitpick); B PASS-WITH-CONCERNS (2 CONCERN).**
Counter stays **0/5**. Two comment-accuracy concerns, both fixed. No logic
defect.

## A's verdict: PASS

A verified every end-state and binding constraint empirically: no CSS transition
or setTimeout in the animation layer, the global singleton + configure/releaseInputs
lifecycle, NavStateMachine as the sole authority (the `#publication` `$derived`
read-through), the four orchestrator-owned rAF channels, FAB/Header as reactive
readers, the five Known conditions, the velocity-matched commit math, the
family-swap ease anchoring, and the `#fabDragSeedFraction` inversion. Zero
concerns.

### A's nitpick (accepted, not fixed)

End-state #3 / the binding constraint say "the orchestrator does not hold a
private `#publication`"; the code declares `readonly #publication = $derived.by(...)`.
In spirit there is no violation: the code comment states the derived has no
independent state (every field is a read-through of the state machine + executor
progress). This is `.md` spec-code drift of the forward-looking-text kind, a
nitpick that does not block PASS. Left as-is (the code is correct; softening the
binding-constraint wording mid-loop is not warranted).

## B's findings

### B1 (CONCERN) - unmount() docstring "and the app exit"

`nav-pipeline-orchestrator.svelte.ts:916-922` claimed `unmount()` is used for
"the mobile->desktop flip ... and the app exit". `unmount()` is only called from
the two hosts' mobile->desktop breakpoint handlers (`NavPipelineHost:351`,
`NavPipelineTabHost:252`); route-away destroys and app exit go through
`releaseInputs` (or simply abandon the singleton). Fixed: the docstring now
states unmount is for the mobile->desktop flip only, route swaps use
releaseInputs, and app exit abandons the singleton (no teardown).

### B2 (CONCERN) - MessagesSkeleton docstring "unreachable"

`MessagesSkeleton.svelte:9-12` claimed the component is "unreachable while the
inbox is eager-loaded ... present for a future non-eager target". It IS reached
today: on `/messages/[id]` the route's message-row array shadows the root
layout's eager-loaded inbox object, so `NavPipelineHost`'s preview `{:else}`
branch renders `MessagesSkeleton` during a back-swipe (the spec's own Known
section documents this). Fixed: the docstring now describes the array-shadow
reachability.

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    409 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:430,
                                     the pre-existing CDP touch flake)
```

Both fixes are comment-only; e2e confirms no regression.

R33 audits the post-R32-fix state.

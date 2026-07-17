# RV20-C05b2 - Audit Round 70

Result: **A PASS-WITH-CONCERNS (1 nitpick + 1 concern); B PASS-WITH-CONCERNS
(1 CONCERN).** Counter stays **0/5**. R70 found one more migration consequence
(B1: FAB reacts during a suppressed-slide gesture) and a latent consistency gap
(A2: playEnterAnimation's outgoing title uses the resolver while the gesture path
uses the live title). No runtime logic bug. All fixed.

## A's findings

1. **playEnterAnimation docstring imprecision (NITPICK, FIXED).** The docstring
   said "the crossfade shows the static back-target title easing toward an empty
   incoming span," but for tab-root back-targets (`/`, `/activity`,
   `/messages/inbox`) the resolver returns null, so the outgoing span is also
   empty. Reworded (part of the A2 fix).
2. **playEnterAnimation outgoing title uses the resolver, not the live title
   (CONCERN, FIXED).** `#armSettleEaseFromGesture` (R64 B1) was fixed to use
   `#prevHeaderTitle` (the live title) for the outgoing, because
   `resolveDeepHeaderTitle` returns null for dynamic-title routes.
   `playEnterAnimation` still used the resolver for the outgoing
   (`resolveDeepHeaderTitle(inputs.backTarget, t) ?? ''`). The divergence was
   masked (current back-targets are tab roots with empty live titles), but it was
   a latent hazard for any future dynamic-title back-target. Fixed: the outgoing
   is now `#prevHeaderTitle`, consistent with the gesture-release path.

## B's finding

1. **FAB reacts during a suppressed-slide gesture (LOGIC, FIXED).** The R69 A1
   fix extended `suppressSlide` to set `distance = 0` for within-tab pagination
   gestures, so the track does not move. But the orchestrator still published
   `progress`, and the FAB layer computed `fabScale(progress, fromHasFab,
   toHasFab)`, fading the FAB in during the second half of the gesture while the
   page was static. Fixed: the FAB layer checks
   `publication.plan?.pageTrack.distance === 0` and short-circuits to the FROM
   route's fab scale (the FAB stays put during the gesture, updates on landing).

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    203 passed + 1 flaky (exit 0, B1 run)
                                      + header-enter e2e 16 pass (A2 verification)
```

R71 audits this state.

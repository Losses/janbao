# RV20-C05b1 - Audit Round 52 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (7 low); B PASS-WITH-CONCERNS
(6 low). **Zero MED/HIGH.** The cleanest round. Both verified every
trajectory correct. A: "No blocking defect found."

## Concerns + fixes

- **beginSlide vestigial closure (A C2 + B C1):** the `beginSlide()`
  closure had a dead abort guard (synchronous call; nothing can move the
  orchestrator between definition and call). Leftover from the preload-defer
  era. FIX: inlined the executor calls directly, removed the closure.
- **stale "BUG:" test labels (B C5):** the pilot's chip-exit test cases
  were named "BUG: previews messages": the pilot's chip-exit is an
  intentional divergence, not a bug. FIX: renamed to "chip-exit: target
  panel revealed."
- **recoverDesktopFlipNav dead on cold-desktop (B C6):** called
  unconditionally in `sync()`'s else branch; on a cold-desktop mount the
  orchestrator was never mounted. FIX: gated on `orchestratorMounted`.
- **journal Design -W/2 typo (A):** the Investigation/Design sections said
  `-W/2` where the code correctly uses `-W` (the R3 fix updated the code
  comments but missed the journal's design docs). FIX: corrected to `-W`.

## Documented / low

- **pilot→non-tab-root fall-through (A C1):** matches GPL. Gate ordering
  fragile for future routes. Latent.
- **navDispatchInFlight dual-field guard (A C3 + B C2):** complex but
  robust (target-match is the actual safety net). No observed failure.
- **hopForHref ignores navigation type (A C4):** matches GPL's adjacency
  limitation. `PilotBeforeNavigateEvent.type` plumbed but unused.
- **forward-enter 1-frame flash (A C5):** matches GPL's `enterRaf`. Below
  e2e resolution.
- **chip-exit easing s(u)=2u-u² vs CSS curve (A C6):** duration matches
  (200ms); shape differs. Honest comment. Acceptable under e2e-gated
  contract.
- **PageLifecycleController vestigial (A C7 + B C4):** integrated but no
  consumer reads `phase` or calls `registerTeardown`. Future-ready for 5b2.
- **gesture-during-dispatch discarded (B C3):** edge case; user intent
  ambiguous; slide already completed. Low.
- **FAB jump on gesture→chip-exit interrupt (B C4):** moot for the pilot
  (fab:false route, no visible FAB).
- **skeleton unreachable (A C2 / B C2):** spec-mandated fallback;
  eager-load makes it unreachable today.

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    81 passed
```

Consecutive pass votes: **0** (R52 carried low concerns; the fixable ones
addressed, the rest documented; R53 audits the post-fix state).

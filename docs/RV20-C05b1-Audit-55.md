# RV20-C05b1 - Audit Round 55 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (7 low); B PASS-WITH-
CONCERNS (3 low). **Zero MED/HIGH** (third consecutive). All concerns are
low (dead code, comment accuracy, edge cases, design properties).

## Concerns + fixes

- **fromPathname $effect corrupts during teardown (B C1, low):** the
  $effect that calls `updateFromPathname` fired during the dispatch's URL
  change (before the host unmounts), briefly setting fromPathname to the
  new URL. FIX: gated on `!publication.inFlight` (only updates at rest,
  not during a transition's dispatch).
- **onSvelteKitAfterNavigate docstring misleading (A C1, low):** claimed
  "this completes the transition" but for away-navs, onDestroy runs before
  afterNavigate (the singleton is already null). FIX: rewrote to describe
  the actual lifecycle (pilot-internal param nav = no-op reset; away-nav
  = singleton null, skipped).

## Documented / low

- mid-slide content swap on gesture-interrupts-chip-exit (A C2): geometry
  continuous, content flashes. Acknowledged in code comment.
- live-drag drop on desktop flip (A C3): intentional (user may cancel;
  on desktop no touch continues). Documented.
- resize mid-slide locks old viewport (A C4): acknowledged; at-rest effect
  corrects after settle.
- hardcoded chip-exit targets (A C5 / B documented): 5b2 scope.
- chipExitState duplicates publication.chipExit (A C6): intentional (flush
  accuracy; added R50-51 to fix $derived-of-$derived latency).
- coordinator never invoked (A C7): shadow-mode for 5b2.
- $derived wrapper for pointerDisabled (B C2): stylistic, functionally
  correct.
- regex mismatch #isPilotFrom vs pilot gate (B C3): unreachable (SvelteKit
  router only produces /p\d+ suffixes).

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    81 passed
```

Consecutive pass votes: **0** (R55 carried low concerns; fixable ones
fixed, rest documented; R56 audits the post-fix state).

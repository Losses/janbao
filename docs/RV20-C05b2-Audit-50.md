# RV20-C05b2 - Audit Round 50

Result: **A PASS-WITH-CONCERNS (1 CONCERN + 1 nitpick); B PASS-WITH-CONCERNS
(3 CONCERN).** Counter stays **0/5**. R50 found four minor issues (dead code,
redundant conditional, two stale comments) and one spec nitpick. All fixed. Both
auditors verified the architecture and all six Known conditions are correct.

## A's findings (1 CONCERN + 1 nitpick)

1. `#beginGesture` docstring (~1250) said "run the resolver + coordinator once";
   the coordinator (Layer 4) is a not-yet-implemented future-cycle concept, never
   invoked. Fixed: removed the coordinator reference.
2. nitpick (spec §5 ~226-229): the "Header morph during gesture drag / commit"
   bullet attributed the drag-half morph to the executor's rAF; during a live drag
   the morph is driven by the orchestrator's synchronous `#publish` (executor rAF
   stopped). Fixed: split into two bullets (drag = synchronous publish; commit =
   executor rAF).

## B's findings (3 CONCERN)

1. Dead `target === undefined || target === null` check (~1518) in
   `#onExecutorSettle`'s commit branch: by the time control reaches here, at
   least one pending slot is non-null and both target types are string. Removed
   (uses a `!` assertion; the both-null case returns earlier).
2. Redundant first conjunct in the mid-settle re-arm (~2306):
   `newTitle !== resolveSettleIncomingTitle()` is tautologically true (the
   equal-to-incoming case returns earlier). Removed; comment updated to note the
   re-arm is skipped when the title equals the OUTGOING title.
3. BurgerArrowIcon docstring (~23) said "the orchestrator's `iconProgress`";
   `iconProgress` is a `$derived.by` in `Header.svelte`, not an orchestrator
   field. Fixed: rewritten to name the Header's derivation.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The flaky test is `fab.spec.ts:436` (the known CDP-touch class). The fixes were
applied by a fresh-context sub-agent (e2e synchronous) and independently
re-verified by the orchestrator.

R51 audits the post-R50-fix state.

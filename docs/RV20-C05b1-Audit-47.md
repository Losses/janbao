# RV20-C05b1 - Audit Round 47 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (5, all low); B
PASS-WITH-CONCERNS (5, all low). Both verified every trajectory correct
(UNIFY, all-rAF, SvelteKit interop, SSR, edge zone, multi-touch, re-grab,
interrupts, desktop flip). No substantive (med/high) concern. The concerns
are long-tail: coverage gaps, theoretical/unreachable edges, a data-source
wording divergence, and a comment overstatement.

## Concerns + disposition

- **Skeleton path structurally unreachable (A C1):** the chip-exit's
  `{:else}` skeleton branch never fires because `page.data.activity`/`home`
  are eager-loaded (truthy) on every route. ActivitySkeleton /
  DiscussionsSkeleton are defensive fallbacks for a future where a target is
  not eager-loaded; they are currently dead code (never rendered). FIX: add a
  comment documenting this (the skeleton is the fallback; the eager-load
  makes it unreachable today, which is the preferred outcome - the real panel
  always shows). The `Skeleton` atom itself IS exercised (the 7 migrated
  sites + LexicalEditorLazy).
- **`page.data` vs `PageCacheStore` (B B4):** the spec says "from the cache";
  the impl reads the eager-loaded root-layout data (`page.data.*`). The two
  are equivalent in practice (the cache is seeded from `data.*`), but the
  data source diverges from the spec wording. FIX: update the spec to "from
  the eager-loaded root-layout data (which the page cache mirrors)".
- **coordinator `ensure`/preload contract unused (A C2):** the docstring says
  the orchestrator "can call `PageCacheStore.ensure`"; no caller does (grep:
  zero `cache.ensure` call sites). FIX: rewrite the comment to drop the
  overstatement (the orchestrator renders the cached panel / skeleton
  directly; it does not call `ensure`).
- **chip-exit FAB pinned at coverProgress=0 (B B1/B5):** moot for the pilot
  - the chip-exit targets `/` and `/activity` are both `fab: false`, so
    there is no FAB to pin or jump. (Matches GPL regardless.) DOCUMENTED.
- **gesture-path `coordinate()` vs tab-click static check (B B2):** the
  first-frame cache-miss case is unreachable (the root layout's seeding
  `$effect` runs before any drag can start). DOCUMENTED (orchestrator
  comment already notes the race).
- **chip-exit dispatch hardcoded to `/` and `/activity` (B B3):** correct
  for the 3 current tab roots; a future 4th tab would need a branch.
  DOCUMENTED (in-scope for 5b2's rollout, not 5b1's pilot).
- **no e2e for deep-link landing (A C4):** FIX - add a cold-load
  `/messages/<id>` test asserting no enter animation + the track rests at
  -50%.
- **`recoverDesktopFlipNav` not on route-away (A C5):** documented
  intentional (the user's fresh nav wins).

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    80 passed
```

Consecutive pass votes: **0** (R47 carried low concerns; the fixable ones
addressed, the rest documented/moot; R48 audits the post-fix state).

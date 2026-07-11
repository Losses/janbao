# RV20-C05b2 - Audit Round 2 (architect-run, 2 independent auditors)

Result: **A 6 CONCERNS (comment-accuracy + deliverable-gap); B FAIL (1 functional
MED + 2 comment concerns).** Counter stays 0/5.

## Fixes

- **B C1 (MED) - Header morph regression on tab host:** NavPipelineTabHost
  mounted with `centerTab: undefined`, causing the orchestrator's deep-page
  branch to publish `backMorph: rawDragFraction` (a number) instead of `null`.
  The Header read `backMorph: 0` (not null) and flipped to back-arrow. FIX:
  `resetPagerStore` and `#republishToPager` now have a third branch (bidirectional
  tab host) that publishes `backMorph: null, active: true` — matching the old
  MobileTabPager.
- **B C2 + A C1-C2 (dead code + stale comments):** removed dead `chipExitActive`
  derivation; rewrote the orchestrator docstring from "pilot route" to "universal
  pipeline"; updated `(tabs)/+layout.svelte` and `/discussion/*` comments.
- **A C3 (dead writes):** `/discussion/*` `beforeNavigate` capture trimmed to
  `{ scrollTop }` only (removed dead `data`/`snippet` captures).
- **A C4-C5 (e2e):** updated `tab-swipe-preview-height.spec.ts` to query
  NavPipelineTabHost's DOM; created `e2e/tab-host-swipe.spec.ts` (tab-to-tab
  swipe with track slide, FAB animation, and Header hamburger-hold assertions).
- **A C6 (architecture note):** the FAB layer's `readRenderedFabScale` DOM
  read-back is documented as a justified deviation from §13.5 (the rAF
  family-swap ease needs the atom's last committed scale at `$effect.pre` time;
  the reactive tracking lost the race on SvelteKit navigation flushes).

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1462 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    429 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab    92 passed
$ bun run test:e2e -- tab-host-swipe tab-swipe-preview-height    2 passed
```

Consecutive pass votes: **0** (B carried a MED + both carried comment concerns;
fixed; R3 audits the post-fix state).

# RV20-C05b1 - Audit Round 46 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (6); B PASS-WITH-CONCERNS (6).
Both audited the post-Session-12 state (skeleton / cached-panel chip-exit)
with a clean prompt that named the chip-exit an accepted divergence. UNIFY,
the all-rAF executor, SvelteKit interop, SSR, the 40px edge zone,
multi-touch, re-grab, and reversed/rebound release were all verified
correct; the chip-exit renders the correct target panel in all four cases.

## Concerns + fixes

- **unmount dispatch over-reach (A C1 + B C4, med):** `unmount()` dispatched
  the pending target in two wrong cases - a pre-commit live-drag (the user
  had not released past `SWIPE_COMMIT`) and a user-navigate-away
  mid-transition (the stale target overrode the user's new destination).
  FIX: removed the dispatch from `unmount()`; added `recoverDesktopFlipNav()`
  (gated on `executor.state.phase === 'committing'` - only a committed slide
  lands), called by the host ONLY on a mobile->desktop flip (not on a
  route-away unmount). A pre-commit drag no longer lands, and a route-away
  lets the user's fresh nav win.
- **stale chip-exit comments (A C2 + B C1 + B C2):** the orchestrator
  (`chipExit` docstring, `#chipExitState` docstring, `#resolvePlan` comment,
  `#republishToPager` docstring) and `nav-coordinator.ts` still described
  the dropped LoadingChip overlay / panelCount=1 design. Rewritten to the
  current skeleton / cached-panel design.
- **dead `restingTranslateOverride` (A C3 + B C3):** no caller passed it
  after Session 12; removed the parameter + the override.
- **LexicalEditorLazy not migrated (A C5):** the 8th spec-listed skeleton
  site still used bespoke `animate-pulse` + `bg-base-300/50`; migrated to
  `<Skeleton>`.
- **`leftEl` dead binding (pre-existing):** declared + `bind:this`-bound but
  never read (since before this cycle); removed both.

## Documented / moot (not code-fixed)

- **chip-exit panel content swap on cross-type interrupt (A C4):** a gesture
  starting mid chip-exit tab-click flips the target, so the left-panel
  content swaps mid-slide. The geometry is continuous
  (`#startProgressFromCurrentVisual`); the swap is inherent to the design
  (the panel reflects whichever transition is in flight). Documented in the
  `chipExitTarget` comment.
- **chip-exit FAB pinned at coverProgress=0 (A C6 + B C5):** moot for the
  pilot - the chip-exit targets `/` and `/activity` are both `fab: false`,
  so there is no FAB to pin or jump. (Matches GPL's behavior regardless.)
- **skeleton-path / chip-exit-FAB e2e coverage (A C5 + B C6):** the
  cached-panel path is covered (`tab-exit-preview` asserts the target tab
  reveals); the skeleton path requires forcing `page.data.*` absent (not
  user-reachable in the eager-loaded flow), and the FAB path is moot above.
  Documented as coverage gaps.

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1461 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    79 passed
```

Consecutive pass votes: **0** (R46 carried concerns; all fixed or
documented; R47 audits the post-fix state).

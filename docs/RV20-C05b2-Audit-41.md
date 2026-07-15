# RV20-C05b2 - Audit Round 41

Result: **A PASS-WITH-CONCERNS (4 CONCERN: 2 logic + 2 docstring); B
PASS-WITH-CONCERNS (5 CONCERN: 1 logic + 4 comment).** Counter stays **0/5**.
R41 found three logic defects and six stale / inaccurate comments. All nine
were fixed; the three logic fixes carry no dedicated preventive e2e (verified
structurally + no e2e regression) and will be re-checked by later rounds.

## A's findings (4 CONCERN)

1. `Header.svelte:133` (logic) - the `morph` dragging branch used `morph =
pager.backMorph` directly. On a backward swipe on a tab host toward a deep
   page, morph must run 1 (tab) -> 0 (deep), but `backMorph` runs 0 -> 1, so
   morph went the wrong way (a 1 -> 0 -> 1 -> 0 double reversal).
2. `nav-resolvers.ts:80-83` (docstring) - `HeaderVisual.morph` docstring
   inverted the semantics ("0 = root, 1 = deep"; actual is 1 = root/tab, 0 =
   deep).
3. `NavPipelineHost.svelte:185-196` (logic) - `forwardDeepTarget`'s
   `isTabRootPath(resolvedLeftHref)` check reads the back-target, not the
   source, so it also suppressed the destination skeleton for a genuine forward
   deep-to-deep when the user reached the source from a tab root.
4. `FloatingActionButton.svelte:12-17` (docstring) - referenced the deleted
   "cross-family family swap" motion.

## B's findings (5 CONCERN)

1. `orchestrator` `#cancelAllAnimationEases` docstring (comment) - claimed it
   is called only from `#beginGesture` and is the sole settle-cancellation
   point; it is also called from the discrete-nav path, and the settle is
   cancelled by several other sites.
2. `orchestrator` `playEnterAnimation` inline comment (comment) - "the
   centerTab branch's backMorph = null drives the Header" was worded
   universally but only holds for thread-host enters.
3. `orchestrator` finish-then-new policy docstring (comment) - omitted the
   cancel-slide case (`phase === 'committing'` is also produced by `onCancel`).
4. `e2e/fab-boundary-swipe-sync.spec.ts:10-29` (docstring) - referenced
   deleted infrastructure (`familySwapScale`, `tabFraction`,
   `foregroundFraction`).
5. `orchestrator:1298-1303` `#beginGesture` `toTabIndex` (logic) - the
   bidirectional-backward case used `fromTabIndex - 1`; on tab 0 with a
   higher-index tab as the history-previous this gave -1, so the resolver
   picked axis 'right' and the slide revealed empty space.

## Fixes

- A1: the morph dragging branch now returns `currentHasTabs ? 1 - backMorph :
backMorph` when `backMorph` is non-null (null fallback unchanged).
- A2: the `HeaderVisual.morph` docstring corrected to `1 = root / tab, 0 =
deep / search`.
- A3: `forwardDeepTarget` now gates on `!publication.lastDispatchWasDeepToDeep`
  instead of `isTabRootPath(resolvedLeftHref)` (the handshake flag is the
  authoritative deep-to-deep signal).
- A4: the FAB transform-driver list trimmed to `route-transition scale,
scroll-hide translateY` (the cross-family swap is gone).
- B1: the `#cancelAllAnimationEases` docstring rewritten to list both call
  sites and the other settle-cancellation sites.
- B2: the `playEnterAnimation` comment qualified to thread-host enters.
- B3: the finish-then-new policy comment extended with the cancel-slide case.
- B4: the `fab-boundary-swipe-sync.spec.ts` header rewritten to the
  `fabScale(progress, fromHasFab, toHasFab)` architecture.
- B5: the bidirectional-backward `toTabIndex` now uses `this.#tabIndexFor(to)`
  (the history-driven target), and the knock-on `#republishToPager` comment was
  updated.

The fix implementation was delegated to a fresh-context sub-agent (context on
the orchestrator side had grown long) and independently re-verified: the diff
for the three logic fixes was checked, and the full gate was re-run by the
orchestrator.

## Gate outputs (post-fix, independently re-run 2026-07-15)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    406 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (exit 0)
```

The one flaky test is `fab.spec.ts:435` (Family B back: thread -> list), a
timing-sensitive rAF-sampling flake on a path none of the three logic fixes
reach (the thread host is non-bidirectional, `currentHasTabs` is false there,
and the forward-only guard returns early on a back swipe). No regression.

R42 audits the post-R41-fix state.

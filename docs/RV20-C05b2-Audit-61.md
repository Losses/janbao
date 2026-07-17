# RV20-C05b2 - Audit Round 61

Result: **A PASS-WITH-CONCERNS (4 CONCERN + 1 borderline); B PASS-WITH-CONCERNS
(1 CONCERN + 1 minor).** Counter stays **0/5**. R61 audited the post-R60 tree.
Both auditors verified the core pipeline clean; the findings are two narrow
settle-branch state bugs (one stuck-settle leak, one stale-settle re-arm skip),
three comment-accuracy issues that obscured the leak, one borderline
(non-animation) `setTimeout`, and one dead-export cleanup. All fixed.

## A's findings

1. **Mid-commit non-pipeline detour strands the settle (LOGIC, FIXED).** If an
   external nav to a non-pipeline route arrives during the ~300 ms commit rAF
   window (after the settle is armed with `awaitTitle` but before
   `#dispatchNav` fires), `onSvelteKitBeforeNavigate` returned `false` without
   cancelling; `releaseInputs` cleared `#pendingGesture` but not the settle;
   the commit rAF then reached u=1 and `#onExecutorSettle`'s both-null branch
   only called `#landAtRest` (a no-op with `#mountInputs === null`). The
   settle's `awaitTitle` never clears, `onSvelteKitAfterNavigate` is gated on
   the orchestrator being active, which `releaseInputs` ends, so
   `settleActive` stays `true` forever and the Header renders the stale
   latched endpoint. Fixed: `onSvelteKitBeforeNavigate` calls
   `#cancelAllAnimationEases()` on the non-pipeline-destination path (leaving
   the pipeline ends the in-flight settle + tap-scrub; no-op when nothing is
   in flight). Same leak class as the R58 supersede settle, different window
   (pre-dispatch, external nav).
2. **`#cancelSettleEaseRaf` docstring (COMMENT, FIXED).** Listed "host
   destroy" / "cleared by releaseInputs", both false (`releaseInputs`
   intentionally does not touch the settle; only `unmount` does). Rewritten to
   name the real callers (`#armSettleEase`, `#endSettleEase`, `unmount`) and
   the intentional `releaseInputs` exception + the new non-pipeline end-site.
3. **`#cancelTapScrubRaf` docstring (COMMENT, FIXED).** Same class; rewritten.
4. **`notifyHeaderState` gap-frame comment (COMMENT, FIXED).** "In the detour
   case no settle is in flight" was the load-bearing false assumption behind
   finding 1. Rewritten: the settle is ended on non-pipeline nav (finding 1's
   fix), so a detour has no in-flight settle by the time this branch runs.
5. **`Header.svelte` search-input `setTimeout` (borderline, CLARIFIED).** A
   strict reading of "no `setTimeout` in the animation layer ... the Header"
   flags the 400 ms search debounce; both auditors concur it is input
   handling, not animation alignment (the §5 bar targets the Header's morph /
   title animation, rAF-driven). A comment now states this inline so the
   debounce is not re-flagged.

## B's findings

1. **Mid-settle re-arm skip strands the Header on a stale title (LOGIC,
   FIXED).** When the route reverts to the settle's OUTGOING title within the
   settle window (FROM -> INCOMING -> FROM on an IDLE title-change settle),
   `notifyHeaderState`'s mid-settle branch skipped the re-arm (`newTitle !== resolveSettleOutgoingTitle()`
   is false), so the settle rAF kept running toward the stale INCOMING
   endpoint and the Header showed the stale title until settle end (then
   snapped). Fixed: the equal-to-outgoing case ends the settle, gated on
   `!#settleAwaitTitle`, only an idle title-change settle (not awaiting a
   nav landing) ends here. A commit settle (`awaitTitle` true) keeps running:
   its live title is the outgoing because the nav has not landed yet, not
   because it reverted, so ending it would snap and replay (the first
   version ended unconditionally and broke `header-tabs-replay` +
   `header-title-replay`; the gate restores them). The
   `enterAnimationArmedSettle` flag is spent in the idle-end path.
2. **Dead export surface (CLEANUP, FIXED).** `PipelineElementRefs`,
   `PipelineElementResolver`, `NavPipelineCancelFn` were `export`-ed but had
   zero external imports. `export` removed (the declarations stay, used
   internally). (`NavPipelineBeforeNavigateEvent` was already not exported.)

## `/discussions/pN` unified onto the pipeline pager (this round, user-requested)

The user asked for `/discussions/pN` (the one route that lost its swipe-to-tab
when the `DualColumnLayout` tab-swipe was deleted) to be unified onto the
pipeline pager rather than left on the tab bar. The fix is one localized move:
`src/routes/discussions/[[page=page]]/` is now under `src/routes/(tabs)/`, so
on mobile the persistent `(tabs)` layout renders `NavPipelineTabHost` for it
(the pager already read `page.data.discussions ?? data.home.discussions` and
built `/discussions/pN` pagination URLs). Desktop is unchanged (`(tabs)`'s
desktop branch renders `children` -> `DiscussionListPage`). Verified by SSR
curl (`/discussions/p2` 200, `/discussions/p1` 308 -> `/`) and a mobile
browser pass (the pager viewport + the activity / messages tab-bar links
render on `/discussions/p2`, same as `/`). No second mechanism, no code
spread.

## Gate outputs (post-fix, independently re-run 2026-07-16)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    377 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (exit 0)
```

R62 audits the post-R61-fix + migration state.

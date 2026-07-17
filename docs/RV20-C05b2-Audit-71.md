# RV20-C05b2 - Audit Round 71

Result: **A PASS-WITH-CONCERNS (1 CONCERN, comment accuracy); B PASS-WITH-CONCERNS
(4 CONCERN + 5 nitpick, all comment accuracy).** Counter stays **0/5**. **R71 has
zero logic bugs in either auditor.** All findings are stale comment/docstring
references to deleted mechanisms (primarily the deleted `MobileTabPager`, referred
to as "tab pager" / "mobile tab pager") plus one incorrect claim in the
`#isOwnDispatchReentry` docstring. All fixed.

## A's finding

1. **`mobile-pager.svelte.ts` `backMorph` docstring internal contradiction
   (COMMENT, FIXED).** The docstring said backMorph is "null everywhere a
   swipe-back is not in progress" but also "0 at rest on the current page." Deep
   pages at rest get `backMorph: 0` (not null). Reworded: null on tab roots,
   threads, and before mount; 0 on deep pages at rest.

## B's findings

1. **`swipe.ts` file-header stale (COMMENT, FIXED).** Referenced "the tab pager"
   (deleted `MobileTabPager`) and "left/right tab switching." Reworded to name the
   current hosts (`NavPipelineHost`, `NavPipelineTabHost`, `SearchScopePager`) and
   the full transition surface.
2. **`#isOwnDispatchReentry` docstring incorrect claim (COMMENT, FIXED).** Claimed
   "a gesture dispatch carries no `#queuedDiscreteNav`", wrong: a gesture commit
   CAN carry a non-null queue if a tab-click interrupted mid-commit via the
   finish-then-new policy. Reworded: the bound is the defense-in-depth clears
   (supersede + `#landAtRest`), not the dispatch being queue-free.
3. **`DiscussionListPage.svelte` stale "mobile tab pager" (COMMENT, FIXED).**
   Reworded to "pipeline tab host."
4. **`updateFromPathname` docstring stale "tab pager" (COMMENT, FIXED).** Reworded
   to "pipeline tab host."
5. **5 nitpicks (stale "mobile tab pager" in non-wiring files, FIXED).**
   `MessagesPanel`, `DiscussionsPanel`, `api.ts`, `tabs.ts`, `activity/+page.svelte`.
   All reworded via batch replacement.

## Gate outputs (post-fix, 2026-07-17)

Comment-only fixes; the e2e gate is unchanged from the R70 post-fix run.

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    203 passed + 1 flaky (exit 0, R70 post-fix run)
```

R72 audits this state.

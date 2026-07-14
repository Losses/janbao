# RV20-C05b2 - Audit Round 24

Result: **A PASS-WITH-CONCERNS (6 CONCERN); B PASS-WITH-CONCERNS (6 CONCERN).**
Counter stays **0/5**. Both auditors agreed the pipeline is behaviorally sound
(UNIFY-not-bridge, one rAF per channel, NavStateMachine as sole authority, no
CSS transition or setTimeout in the animation layer, MobileTabPager and
GesturePageLayout deleted, route classifier renamed). Both returned the SAME six
code-comment-accuracy concerns, all one defect class: comments in `.ts` /
`.svelte.ts` / `.test.ts` describing the deleted `GesturePageLayout.svelte` and
`MobileTabPager.svelte` as "unmounted, pending 5b3 deletion" when both files
were DELETED in 5b2 (R23, commit 149aa14).

The orchestrator's independent sibling grep found a seventh reference of the
same class that both auditors missed: `NavPipelineTabHost.svelte:6`
("Replaces MobileTabPager on the (tabs) layout").

## Merged finding set (7 locations, all CONCERN, comment accuracy)

1. `src/lib/utils/gesture-constants.ts:18-20` - SWIPE_COMMIT comment cited
   `GesturePageLayout.svelte:275` as "unmounted, pending 5b3 deletion".
2. `src/lib/utils/route-data.ts:50-60` - `backParent` docstring listed
   `GesturePageLayout.resolvedLeftHref` as a second transitional consumer; that
   consumer no longer exists (GPL deleted). Verified: the sole remaining
   `backParent` consumer is `isPipelineSwipeDisabledRoute`.
3. `src/lib/types/page-cache-shapes.ts:16,87-134` - `ThreadSnapshotCacheData`
   docstring named the deleted `MobileTabPager` as its reader; the type and its
   two sub-shapes (`ThreadDiscussionShape`, `ThreadReplyShape`) have zero
   consumers.
4. `src/lib/stores/page-cache.svelte.ts:113-122` - `getLatestWithSnippet`
   docstring named the deleted `MobileTabPager` as its sole consumer. Verified:
   zero production callers.
5. `src/lib/stores/page-cache-logic.ts:133-149` - `findLatestWithSnippet`
   docstring carried the identical stale claim; its only caller was the dead
   `getLatestWithSnippet`.
6. `src/lib/stores/navigation-logic.test.ts:121-128` - test rationale comment
   used present tense for `GesturePageLayout.shouldAnimateEnter`.
7. `src/lib/components/templates/NavPipelineTabHost.svelte:6` (found by the
   orchestrator, missed by both auditors) - header comment "Replaces
   MobileTabPager on the (tabs) layout".

## Fixes applied

### Comment rewrites (findings 1, 2, 6, 7)

- `gesture-constants.ts`: removed the three-line GPL reference; SWIPE_COMMIT now
  documents only the orchestrator release-gate consumer.
- `route-data.ts`: `backParent` docstring now states one transitional consumer
  (`isPipelineSwipeDisabledRoute`), not two; the GPL consumer bullet is removed
  and the dissolution line reads "When that consumer is gone".
- `navigation-logic.test.ts`: rewritten to describe the enter-slide behavior
  without naming the deleted component; the reference to the live
  `enter-animation.spec.ts` e2e is retained (verified present under `e2e/`).
- `NavPipelineTabHost.svelte`: header comment no longer references MobileTabPager.

### Dead-code deletion (findings 3, 4, 5)

The thread-snapshot machinery was orphaned by the R23 MobileTabPager deletion
(its sole consumer). Verified dead before deletion: zero production writers,
zero readers. Deleted:

- `ThreadSnapshotCacheData`, `ThreadDiscussionShape`, `ThreadReplyShape` from
  `page-cache-shapes.ts` (plus the header-docstring bullet and the now-unused
  `TranslationDict` / `UserInfoSummary` imports).
- `getLatestWithSnippet` from `page-cache.svelte.ts` (plus its
  `findLatestWithSnippet` import).
- `findLatestWithSnippet` from `page-cache-logic.ts`.
- the "latest with snippet" describe block (3 tests) and the
  `findLatestWithSnippet` import from `page-cache.test.ts`.

### Scope decision (deferred, documented)

The cache entry's `snippet` field (`page-cache-svelte-types.ts`) is now
write-only in production after the reader deletion. It is a general-purpose
cache field defined by DV20-Plan section 7; removing it requires verifying
section 7's entry shape to avoid a spec divergence. It was not flagged by either
auditor and is left in place this round. If a future round confirms it is dead
against the plan, it will be removed then.

## Gate outputs (post-fix, independently re-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    408 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:442,
                                     the pre-existing CDP touch flake; passes
                                     on retry within the run) = 202 total
```

Unit count dropped from 411 to 408, matching exactly the three deleted snippet
tests. The e2e result is identical to the pre-fix state, confirming no behavioral
regression from the comment rewrites and dead-code deletion.

R25 audits the post-R24-fix state.

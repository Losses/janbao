# RV20-C05b2 - Audit Round 5 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (1 MED + 1 MED/LOW + 3 LOW); B PASS-WITH-CONCERNS
(1 MED + 3 LOW).** Counter stays 0/5.

Both auditors verified the core pipeline is sound: no `getComputedStyle` /
`setTimeout` / CSS transition in the gesture layer proper (the Family A sampler
is gone; the only DOM read-back is Known #1 `readRenderedFabScale`), the state
machine is the sole macro authority, the re-grab continuity + boundary +
multi-panel geometry + reduced-motion paths all hold, and `MobileTabPager` /
`GesturePageLayout` are mounted on no route. Findings triaged for validity.

## Consensus

- **`/discussions/pN` (paginated discussions) is a DualColumnLayout route, not
  on the pipeline (A #1 / B #1).** Real. It is mobile-reachable
  (NavPipelineTabHost's DiscussionsPanel paginates to it) and its tab-switch
  gesture runs on DualColumnLayout's `detectSwipe` + CSS transition. It was
  never on `GesturePageLayout` / `MobileTabPager`, so it is outside end-state
  #1's migration set; both auditors noted DualColumnLayout deletion is 5b3.
  Resolution: end-state #1 is qualified ("SOLE for every route that was on those
  two hosts"; DualColumnLayout routes are 5b3) + Known condition #5.

## A-only

- **`backSwipeShouldPopHistory` retained though §6 says deleted (A #2).** Real
  spec divergence. The orchestrator's `#backwardTabTarget` needs it to
  distinguish a backward-to-deep-page pop from a spatial tab switch; the generic
  `hopForHref` does not encode that. Documented as Known #6 (future-cycle
  alignment with §6).
- **Stale comments (A #3):** `mobile-pager.svelte.ts` (coverProgress "published
  by GesturePageLayout"), `route-data.ts` (backParent consumer
  GesturePageLayout.resolvedLeftHref described as live), `e2e/fab.spec.ts`
  (`fab-transition` class + GPL `pendingNav`). Real. All rewritten.
- **Forward deep-to-deep nav not pipeline-driven (A #4).** Real;
  `onSvelteKitBeforeNavigate` intercepts only tab-root targets, so
  `/profile` -> `/profile/settings` is plain SvelteKit nav. Consistent with
  5b2's transition-type scope. Documented as Known #6.
- **Coverage gaps (A #5):** no e2e for backward tab swipe, boundary void-swipe,
  mid-commit re-grab, backward-to-deep. Real. Documented as Known #7 (TODO).

## B-only

- **`effectiveKind` comment says "midpoint" (B #2).** Real comment inaccuracy:
  the kind swaps at `trackFrac = 1` (the tab-0/tab-1 boundary) — the midpoint
  of a multi-panel swap, the destination of an adjacent one. Rewritten.
- **`TAB_CLICK_COMMIT_MS` hardcoded 200ms (B #3).** Real §13.3 tension.
  Tab-click/enter are discrete navs with no release velocity; their fixed 200ms
  matches the Header title crossfade. Gesture commits use the velocity solver
  per §5. Documented as Known #6.
- **`e2e/fab-compose-backswipe.spec.ts` stale header (B #4).** Real (named
  GesturePageLayout + chip-exit + LoadingChip). Rewritten to the orchestrator
  framing.

## No new code-behavior change

R5's fixes are comment accuracy + spec documentation (end-state #1 qualification
+ Known conditions #5-7). No gesture/FAB/executor behavior changed, so the e2e
gate is unchanged from R4 (94 passed).

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab tab-host-swipe tab-swipe-preview-height    94 passed (R4, unchanged)
```

Consecutive pass votes: **0/5** (A PWC + B PWC; the comment concerns fixed,
`/discussions/pN` + the macro-plan divergences documented as Known conditions;
R6 audits the post-fix state).

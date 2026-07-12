# RV20-C05b2 - Audit Round 4 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (1 MED + 2 CONCERN + 1 LOW); B PASS-WITH-CONCERNS
(1 MED + 2 CONCERN + 2 LOW).** Counter stays 0/5.

Both auditors were run with a clean, role-less, non-leading prompt that
**explicitly forbade reading the Journal and all `RV20-C05b2-Audit-*.md`
files**, and pointed them at the spec's "Known 5b2 conditions" section. Both
verified the macro architecture, the geometry, the UNIFY invariant, the
state-machine authority, and the SvelteKit interop. Findings were triaged for
validity before any fix.

## Consensus

- **`isPipelineSwipeDisabledRoute` latent mis-classification not in the Known
  list (A #4 / B #3).** Real: the function returns `false` for `/search`,
  `/bookmarks`, `/notifications`, `/profile` despite their mounting
  `NavPipelineHost`; it does not manifest because `DualColumnLayout`'s parallel
  `detectSwipe` is disabled by its own `swipeBaseline < 0` check. Documented in
  code; now also added to the spec's Known 5b2 conditions (#4).
- **Stale comments referencing unmounted components (A #3 / B #2).** Real.
  Rewrote `history-nav.ts` (MobileTabPager/GesturePageLayout consumers ->
  NavPipelineTabHost/NavPipelineHost), `route-config.ts`
  (`PREVIEW_PANEL_CONFIG` deep-preview slot -> NavPipelineHost left panel;
  `FabFamily`/sampler phrasing), `DualColumnLayout.svelte` (MobileTabPager owns
  the swipe -> NavPipelineTabHost), and `e2e/enter-animation.spec.ts`
  (GesturePageLayout -> NavPipelineHost.playEnterAnimation).

## A-only

- **MED #1 - track translateX jumps on a direction-reversing re-grab with
  negative startProgress (bidirectional host).** Real, the mirror of R3's HIGH:
  the `rawDrag < 0` branch `Math.max(0, startProgress + rawDrag)` clamped a
  negative extrapolated `startProgress` to 0, a half-panel jump. FIX: the lower
  bound is now `Math.min(0, startProgress)` (0 for from-rest/mid-transition
  grabs, `startProgress` for a reverse re-grab), so the track holds continuous
  with the visual (§5 "No jump").
- **CONCERN #2 - `route-data.ts` field comment names `isGesturePageLayoutRoute`.**
  **Invalid for the current state** (verified by re-reading 49-65): the comment
  already names `isPipelineSwipeDisabledRoute`; the function
  `isGesturePageLayoutRoute` does not appear. Not changed (the auditor likely
  read a stale cache). The comment's `GesturePageLayout.resolvedLeftHref`
  consumer reference is the GPL file pending 5b3 deletion, accurately described
  as transitional.

## B-only

- **MED #1 - FAB family-swap ease ignores `prefers-reduced-motion` (§5
  non-negotiable).** Real: `startFamilySwapEase` always ran the 200ms rAF. FIX:
  a `matchMedia('(prefers-reduced-motion: reduce)')` gate snaps
  (`familySwapScale = null`, the published scale falls through to the new
  family's resting scale) with no rAF integration.
- **LOW #4 - no compose forward-enter e2e.** Real coverage gap. Carried as a
  TODO (the `playEnterAnimation` path for compose-family routes is untested at
  the e2e level).
- **LOW #5 - `#publication` field naming vs end-state #3's literal wording.**
  The field is a `$derived` read-through (compliant); the class docstring
  (lines 44-51) already qualifies it as "not an independent publication
  `$state`." Renaming deferred (the existing qualification addresses the
  confusion).

## Architectural: Family A FAB sampler eliminated (§13.4 / §5)

R3 documented the Family A sampler (per-frame `getComputedStyle` DOM read-back)
as a Known condition with a TODO. Per §13.4 (UNIFY) + §5 (no DOM read-back) it
is eliminated this round, not deferred:

- The orchestrator publishes the tab host's 1:1 track fractional position
  (`pager.trackFractionalIndex`), computed from
  `trackTranslateX(plan, executor.progress)` in `#republishToPager` (and
  `fromIdx` at rest in `resetPagerStore`). This signal covers the drag, the
  mid-commit re-grab, and the first/last-tab rubber-band (the published
  `fractionalIndex` is the threshold-absorbed pill position; `coverProgress` is
  the raw drag fraction; neither was the 1:1 track position the Family A FAB
  follows).
- The FAB layer reads `pager.trackFractionalIndex` reactively. The sampler
  machinery (`sampleFraction`, `startSampler`, `stopSampler`, the arm/disarm
  `$effect`, the `sampledFractionalIndex`/`samplerActive`/`samplerRafId`
  state), the now-unused `track`/`activeGestureTrack`/`getActiveGestureTrack`
  binding, and the dead `familyNeedsSamplerDuringDrag` helper + its unit test
  are removed.

`readRenderedFabScale` (the family-swap ease's one-shot `fromScale` anchor) is
retained as Known condition #1: it is a single read at swap-start (not a
per-frame parallel mechanism), immune to the reactive race on a SvelteKit
flush. Its elimination (a post-DOM `$state` for the last-committed scale) is
the next-round item.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab tab-host-swipe tab-swipe-preview-height    94 passed (3.7m)
```

Consecutive pass votes: **0/5** (A PWC + B PWC; the MEDs + comment concerns
fixed, the sampler eliminated, `isPipelineSwipeDisabledRoute` documented; R5
audits the post-fix state).

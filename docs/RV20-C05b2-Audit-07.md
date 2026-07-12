# RV20-C05b2 - Audit Round 7 (architect-run, 2 independent auditors)

Result: **A PASS-WITH-CONCERNS (2 CONCERN + 4 LOW); B PASS-WITH-CONCERNS
(3 LOW).** Counter stays 0/5.

Both verified the core pipeline sound and traced every trajectory clean
(gesture, tab-click, cross-tab, deep-link, forward enter, tab-to-tab, boundary,
mid-commit re-grab both directions, mobile->desktop breakpoint mid-commit). All
six spec claims PASS. Findings triaged for validity.

## Fixed

- **A #1/#2 - `active-gesture-track` dead writes + stale sampler comments.**
  Real, a consequence of R4's sampler elimination: the FAB layer was the store's
  only reader, so after its removal the store was dead, but the live hosts still
  published to it and the comments still described the deleted sampler. FIX:
  removed the live writers (`setActiveGestureTrack`/`clearActiveGestureTrack`
  imports + publish `$effect` + teardown clear in `NavPipelineHost` and
  `NavPipelineTabHost`; `initActiveGestureTrack` in `+layout.svelte`) and
  rewrote the comments. The store file itself stays (the dead `MobileTabPager`/
  `GesturePageLayout` files import it; it deletes with them in 5b3). Also fixed
  the orchestrator's two stale "sampler" comment references (-> "coverProgress
  driver" / "published trackFractionalIndex") and the NavPipelineHost header.
- **B C1 - `effectiveKind` comment overgeneralized.** Real: the comment said
  "ALWAYS active" but the track-position kind switch only applies on the tab host
  (`trackFractionalIndex !== null`); deep pages fall through to the URL/config
  kind. FIX: qualified the comment to the tab host.

## Documented as Known conditions (#8-11)

- **A #3 - singleton state-machine one-frame stale window on a route swap.**
  Latent (no visible artifact: prior `unmount()` clears the pager store; SSR
  initial transform holds the visual); `mount()->forceReset` clears it next
  frame. Known #8.
- **B C2 - backward-to-deep-page visual proxy.** The slide reveals the previous
  tab panel; on commit `history.back()` lands on the deep page. The deep-snapshot
  overlay is the orchestrator's `TODO(5b3)`. Known #9 (the visible consequence
  of #6's `backSwipeShouldPopHistory`).
- **B C3 - `pointercancel` treated as a regular release.** Pre-existing
  (`detectSwipe` routes `pointercancel`->`onEnd`; the bridge cannot distinguish
  it inside `onEnd`); rare; the clean fix is coupled to the 5b3 `detectSwipe`
  rework. Known #10.
- **A #5 - `SearchScopePager` nested CSS transition.** Sanctioned by macro §9
  (a nested sub-pager, not a top-level pair); outside 5b2's migration set. Known
  #11.
- **A #4 - skeleton branches unreachable.** Carried (the 5b1 Known #1; the
  root layout's `Promise.allSettled` returns truthy `EMPTY_*` so the `{:else}`
  skeleton branches never render). Code-comment-acknowledged.
- **A #6 - coverage gaps.** Known #3 (velocity e2e) + #7 (backward tab swipe,
  boundary, re-grab, backward-to-deep e2e).

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab tab-host-swipe tab-swipe-preview-height    94 passed (3.7m)
```

Consecutive pass votes: **0/5** (A PWC + B PWC; the dead-store + comment
concerns fixed, the latent/scope items documented as Known #8-11). R8 audits
the post-fix state.

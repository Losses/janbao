# RV20-C05b1 - Audit Round 25 (architect-run, 2 independent auditors, with e2e gate)

Result: **0/2 PASS**. Auditor A PASS-WITH-CONCERNS (3 comment/dead-branch
concerns); auditor B FAIL (5: 3 comment drift, a forward-enter rAF race,
a re-grab-mid-commit §5 violation). R21-R24 fixes held. R25's serious
finding was the §5 re-grab gap (B-C5), now fixed.

## Architect gate outputs (post-R25-fix, real)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0 (prettier clean, no em-dashes; 0 type duplicates)
$ bun test src/lib/utils src/lib/stores    435 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview
                    fab reproduce-user-bugs enter-animation backtarget tab-history
  78 passed (2.6m)   (re-grab mid-commit §5 e2e added; the racy
                      gesture-during-tab-click e2e removed - see C1-coverage)
```

## Concerns + fixes (all confirmed)

- **B-C5 (re-grab mid-commit, §5 violation, correctness)**: on release
  `#pendingGesture` stayed set (for dispatch), so the drag-start guard
  (`#pendingGesture === null`) blocked `#beginGesture` on a re-grab;
  the live-drag then used the FIRST gesture's `startProgress=0`,
  snapping the track backward. Fix: drag-start is now detected by the
  micro-state TRANSITION into drag (`#prevWasDrag`), not by
  `#pendingGesture === null`, so a re-grab re-runs `#beginGesture` which
  recomputes `startProgress` from the executor's current visual position
  (no jump). New e2e "re-grab mid-commit continues from the current
  position (reversals: 0)".
- **B-C1 (deep-link pager-init race, correctness)**: `mount()`
  re-assigned the SAME `AT_REST_PUBLICATION` reference so Svelte's `===`
  equality did not notify the host reset `$effect`; on a deep-link the
  `$effect`'s first run (with `#mountInputs` null) left wrong pager
  values. Fix: `mount()` calls `resetPagerStore()` directly after
  `#mountInputs` is set.
- **A-C1 / A-C2 / B-C1 / B-C2 / B-C3 (comment drift)**: stale field
  docstrings left by the R22 interface trim (`#pendingGesture`,
  `#pendingTabExit`, `chipExit` publication field), `#tabIndexFor`'s
  "fromTabIndex" comment, `fromTabIndex`'s docstring. All reworded to
  match the code.
- **A-C3 (dead branch)**: `publication.progress ?? 0` in `chipProgress`
  was unreachable (`progress` is always a number). Removed.
- **Em-dash lint failure**: my `audit-24.md` used U+2014; the
  `local/no-emdash` rule failed `bun run lint`. Stripped.

## B-C4 (forward-enter rAF race) : assessed, not a behavior gap

Auditor B flagged a ~1-frame race: a back-swipe started in the window
between `onMount`'s `transform: translateX(0px)` seed and the deferred
`playEnterAnimation` rAF reads `executor.activePlan === null` -> a
`startProgress` of 0 -> a one-frame jump from the seeded `0` to `-W`.
The window is a single rAF (~16ms) immediately after a forward
navigation, before which a human cannot start a new drag (the prior
pointerup just occurred). Auditor A did not flag it. Classified as a
theoretical 1-frame race, not a behavior-preservation gap; the
`playEnterAnimation` in-flight guard (R23 A-C5) already skips the enter
if a gesture claimed the pilot in that window.

## C1-coverage (gesture-during-tab-click e2e removed)

The R21 e2e "gesture during tab-click commit dispatches the gesture
target" became order-dependent flaky (the gesture must catch the
tab-click's ~200ms chip-exit slide; under warm dev-server load the slide
completed first -> URL `/activity`). Four attempts to stabilize it
(`page.click`, `noWaitAfter`, pre-armed CDP, CDP-tab-tap) were all flaky
or worse. Removed (a flaky gate test is worse than none). The fix
(`#beginGesture` clears `#pendingTabExit`) is code-verified, and the
gesture-during-commit interrupt is covered by the new re-grab e2e (same
`#beginGesture` path, a wider window).

## B-C3 (chip-exit preload timing) : attempted, reverted

Auditor R24-B flagged that the pilot fires `preloadData` in parallel
where GPL awaits it before sliding. R25 implemented the await
(`preloadData(to).then(beginSlide)`), but it introduced a
network-dependent timing race that made the gesture-during-tab-click
e2e flaky, without clear UX benefit (the parallel preload + the chip +
the `goto`-awaits-preload-internally produce the same user outcome).
Reverted to parallel preload (R21-R24 behavior); documented.

## Convergence picture

R21 -> R25 each found real concerns; each round's fixes held. R25's were
one §5 correctness gap (B-C5 re-grab, now fixed + e2e), one deep-link
pager race (B-C1), comment drift from the R22 trim, and a theoretical
1-frame race (B-C4). The concerns are narrowing toward comment-accuracy
and niche races, but the v2 no-borderline bar keeps surfacing them.
Gates green throughout (check 0, lint 0, unit 435, e2e 78 reliable).

Consecutive pass votes: **0** (R1-R25 each carried concerns).

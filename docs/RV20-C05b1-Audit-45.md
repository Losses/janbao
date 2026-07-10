# RV20-C05b1 - Audit Round 45 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (8); B PASS-WITH-CONCERNS (4).
Both audited the post-R44 state (slide-while-loading chip-exit) with a
clean, role-less prompt; neither saw prior-round results.

This round's chip-exit concerns are **superseded by the Session 12 skeleton
redesign**: the loading chip is dropped and the chip-exit is a 2-panel
direct slide that reveals the cached target panel (or a layout-matched
skeleton). The non-chip-exit concerns are carried below for R46.

## Superseded by Session 12 (chip-exit redesign)

- **A C1/C2/C3 (the panelCount=1 geometry seam on chip-exit <-> non-chip-
  exit interrupts):** the chip-exit used panelCount=1 (restingTranslate=0)
  while every other transition used panelCount=2 (restingTranslate=-W); a
  mid-transition interrupt clamped the cross-geometry handoff and jumped
  the track. Session 12 reverted the chip-exit to panelCount=2 (same
  geometry as the back-swipe), so the seam cannot arise. SUPERSEDED.
- **A C4 (#startProgressFromCurrentVisual "whatever its geometry"
  docstring):** with panelCount=2 throughout, the handoff IS
  geometry-consistent; the docstring is now accurate. SUPERSEDED.
- **B C1 (spec tension "indistinguishable except flash"):** the spec (End
  state #1) was updated to make the chip-exit an accepted divergence.
  SUPERSEDED.
- **B C3 (chip overlay opacity / pulsing / expanded divergences from
  GPL):** the chip overlay is removed entirely. SUPERSEDED.
- **B C4 (chip-exit preload has no timeout):** the preload gating is
  removed (dispatch on settle; the nav loads the target). SUPERSEDED.
- **B C2 (chip-exit slide trajectory not asserted):** `tab-exit-preview`
  now sees the target tab (e.g. `seenTabs: ['activity']` for /activity);
  the trajectory is sampled. ADDRESSED.

## Still open (non-chip-exit; carried to R46)

- **A C5 (e2e coverage gap on cross-geometry interrupts):** no e2e drives
  a chip-exit target during a gesture commit or forward-enter. The bug it
  would have caught (the seam) is gone, but the coverage gap itself
  remains. Low.
- **A C6 (cancel duration 300ms vs GPL's 200ms for forward / near-zero
  release):** `solveCommitDuration` returns `COMMIT_T_DEFAULT_MS` (300)
  for the wrong-direction / near-zero branch; GPL's cancel is CSS
  `duration-200`. The pilot's cancel is ~100ms longer on those releases.
  Low.
- **A C7 (`navDispatchInFlight` passthrough drops a rapid second
  tab-click):** between settle-dispatch and `goto.finally` clearing the
  flag, a second tab-click falls through to plain SvelteKit nav (no slide).
  ~1-frame window. Low.
- **A C8 (host `style` attribute can clobber the driver's inline transform
  on chipExit/isMobile flips):** chipExit no longer changes panelCount, so
  the chipExit-flip clobber is reduced; the isMobile-flip clobber remains
  (timing-dependent, not an active bug today). Low.

Consecutive pass votes: **0** (R45 carried concerns; the chip-exit ones
are superseded by Session 12; the four non-chip concerns above are open for
R46).

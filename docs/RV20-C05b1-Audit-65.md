# RV20-C05b1 - Audit Round 65 (architect-run, 2 independent auditors)

Result: **A PASS (2 observations, both non-blocking / no-change); B
PASS-WITH-CONCERNS (1 CONCERN + 4 LOW).** Zero HIGH/MED. Counter stays 0/5.

Both auditors verified UNIFY (no bridge), no forbidden patterns, the all-rAF
executor, §9, the back-swipe / chip-exit / forward-enter geometry, the interrupt
handoff (continuous across every interrupt combination), the `coverProgress`
continuity, the release gate, and the chip-exit divergence. Both were run with a
clean, role-less, non-leading prompt that **explicitly forbade reading the
Journal and all `RV20-C05b1-Audit-*.md` files**; neither saw prior-round results.

## Fixes

- **B C2 (LOW) - `isNavPipelinePilotRoute` regex broader than the route:** after
  stripping `/pN` the regex still allowed any single trailing segment
  (`/messages/123/foo` matched). No misbehavior (NavPipelineHost never mounts on
  a 404), but over-broad. FIX: tightened to `/^\/messages\/\d+$/` (the `/pN`
  strip already handles paged conversations).
- **B C4 (LOW) - `orchestratorMounted` was a plain `let`, not `$state`:** the
  `updateFromPathname` `$effect` read it, so it was non-reactive (worked only
  because `page.url.pathname` / `publication.inFlight` changes coincided with
  mount state). FIX: `let orchestratorMounted = $state(false);` so the effect
  tracks mount state explicitly.
- **B C5 (LOW) - comment accuracy:** the chip-exit comment's "the real panel
  always renders" overstated the `EMPTY_*` fallback (a truthy-but-empty object on
  a partial-load failure renders an EMPTY panel, not "the real" one). FIX:
  reworded to "the panel always renders - the real list, or the truthy-but-empty
  EMPTY\_\* on a partial-load failure (never the skeleton)".

## Documented (non-defects / accepted divergence / unreachable)

- **B C1 (CONCERN) - chip-exit FAB (`coverProgress = 0` for the whole slide):**
  the FAB stays at scale 0 through the chip-exit slide and appears on landing via
  the family-swap CSS transition; a mid-slide interrupt from a non-chip-exit
  tab-click (whose `coverProgress` was ramping) drops it to 0. This is the
  chip-exit divergence: R64-A explicitly accepted `coverProgress = 0` as the
  cleaner choice (vs GPL's wrong-list FAB), the spec's divergence clause covers
  the chip-exit, and the FAB atom's CSS transition softens the drop. B also
  acknowledged "under a strict reading the FAB behaviour is part of the approved
  divergence". Documented; flagged to the owner (whether the FAB should ramp with
  the slide instead is a design call).
- **B C3 (LOW) - edge-dead-zone source mismatch:** the pointer / `detectSwipe`
  use `window.innerWidth` while the classifier's `isEdgeReserve` uses
  `viewportWidth` (`clientWidth`). They can differ with a scrollbar - but the
  gesture pipeline is mobile-only, and mobile has no scrollbar, so
  `innerWidth === clientWidth` and the mismatch is unreachable in practice.
  Documented.
- **A C1 - FAB trajectory in rapid enter -> back-swipe:** an intentional,
  e2e-accepted difference (the orchestrator ramps `coverProgress` via rAF; the
  e2e asserts the ramp). A subtle trajectory shape in an edge case. No change.
- **A C2 - architectural note (`navStore.pendingNav` unused by the pilot):**
  harmless - the pilot's FAB is Family B (overlay), and the FAB layer's
  `chipExitActive` is gated to `family === 'list'`, so it returns false
  regardless; the chip-exit's FAB-hiding is via `coverProgress = 0`. No change.

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- tab-click-transition tab-exit-preview messages-back-swipe fab    91 passed
```

Consecutive pass votes: **0** (B carried a CONCERN + LOWs; 3 fixed, 2 documented;
R66 audits the post-fix state).

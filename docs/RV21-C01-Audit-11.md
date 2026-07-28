# RV21-C01 Audit 11 (R11)

**Date:** 2026-07-27. **Round:** R11. **Counter after:** 0/5 (auditor A TBD; auditor B BLOCK).
**Gate at audit time:** `bun run check` 0/0; `bun run lint` exit 0; `bunx tsc -p
scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0.

Auditor B (mine) found one new §5 defect at the drag-to-settle handoff for the FAB
layer, verified empirically with a temporary probe spec (deleted before writing this
report). The morph tier is continuous at this handoff (the audit's R5/R6/R7/R10
fixes gave it `#dragMorphAtSettleTakeover`, which captures the drag's terminal
morph into `settleLatched.startMorph`); the FAB tier is NOT (the R8-A F3 fix added
`#dragFabAnchor` for the SETTLE-TO-DRAG direction, but no symmetric mechanism exists
for the DRAG-TO-SETTLE direction; the R8-A F4 fix added `#enterFabAnchor` for the
commit-to-enter handoff only). The probe captures a ~0.8 fabScale snap in a single
rAF frame at the release boundary for a re-grab-then-cancel scenario; the morph
signals (rootLayerTy, burgerRot) stay flat at the same boundary, confirming the
asymmetry.

## B-F1 (§5, concern): FAB scale snaps at the drag-to-settle handoff when `#dragFabAnchor` is in flight

**Sites:**

- `src/lib/utils/fab-scale.ts:180-184` (`computeFabScale` branch 4, the dragAnchor
  shift formula). The formula yields
  `anchor.scale + natural(progress) - natural(anchor.raw)`, a constant offset from
  the natural curve. The offset is
  `anchor.scale - natural(anchor.raw)`, non-zero whenever the prior settle's
  FAB value at the takeover (`anchor.scale`, captured via `#fabScaleAtSettleInstant`
  from the prior settle's `computeFabScale` output) differs from the new plan's
  natural formula at `anchor.raw` (e.g. the prior settle and the new drag use
  from-only-FAB / to-only-FAB / boundary / suppressed / enterAnchor branches that
  produce asymmetric curves).
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2946-3044`
  (`#armSettleEaseFromGesture`): captures `startMorph` for the morph tier via
  `#dragMorphAtSettleTakeover` so the new settle's morph starts at the drag's
  terminal morph. NO equivalent capture for the FAB; the settle reads branch 5
  (default natural) after `#armSettleEase` clears `#dragFabAnchor` at line 2814.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2500-2667`
  (`onSvelteKitBeforeNavigate` discrete-nav arm): the same gap for the
  drag-to-discrete-nav handoff. `liveDragMorph` is captured for the morph tier
  (line 2500); no `liveDragFab` for the FAB.

**Concrete failure scenario (probe-verified):**

1. User is on `/messages/inbox` (last tab, has FAB). The previous history entry is
   `/bookmarks` (a deep page), so the bidirectional host's `#backwardTabTarget`
   returns `/bookmarks` and the orchestrator publishes live
   `backMorph: rawDragFraction` for a backward-to-deep-page gesture.
2. User back-swipes 240px past `SWIPE_COMMIT`. The gesture commits; the commit
   slide + settle run. Publication stays on `/messages/inbox -> /bookmarks`
   end-to-end (the navigation has not landed yet).
3. Mid-commit-settle (within the same CDP touch session, no async gap), the user
   re-grabs forward (leftward). `#beginGesture` captures `#dragMorphAnchor` and
   `#dragFabAnchor` from the prior settle's in-flight morph and FAB. At the
   takeover the prior settle has advanced to `priorProgress ~= 0.95`, so
   `anchor.scale = fabScale(0.95, true, false) = 0` (saturated) and
   `anchor.raw = startProgress = 1 - 0.95 = 0.05` (the new plan's raw scale).
   The new plan is `/messages/inbox -> /search`, so the natural formula is
   `fabScale(progress, true, false)`, with `natural(anchor.raw=0.05) = 0.9`.
   Offset = `anchor.scale - natural(anchor.raw) = -0.9`.
4. User releases the forward re-grab below `SWIPE_COMMIT` (40px drag). The
   forward-swipe-to-`/search` CANCELS. `#armSettleEaseFromGesture(false)` runs,
   which calls `#armSettleEase`. `#armSettleEase` clears `#dragFabAnchor`
   (line 2814). The cancel settle's first frame publishes
   `publication.progress = releaseBm ~= 0.1`. The FAB layer reads branch 5:
   `fabScale(0.1, true, false) = 0.8`. The drag's terminal frame had FAB at
   `shifted(0.1) = 0 + natural(0.1) - natural(0.05) = 0.8 - 0.9 = -0.1`,
   clamped to 0. The FAB snaps from 0 to 0.8 in one rAF frame.

**Probe output (single run, sampler window 3000ms):**

```
PROBE_FAB_CANCEL_REGRAB {"fabJumps":{"max":0.796438,"maxAt":769},
  "rootJumps":{"max":3.19,"maxAt":818},"burgerJumps":{"max":14.37,"maxAt":818},
  "finalPath":"/messages/inbox","frameCount":182,
  "aroundSnap":[
    {"t":702,"fab":0,     "root":-31.82,"burger":143.2,  "tt":"/search","bm":0.092},
    {"t":769,"fab":0.796, "root":-31.82,"burger":143.2,  "tt":"/search","bm":0.102},  <-- SNAP
    {"t":785,"fab":0.842, "root":-31.19,"burger":140.35, "tt":"/search","bm":0.079},
    {"t":802,"fab":0.858, "root":-28.42,"burger":127.88, "tt":"/search","bm":0.071}
  ]}
```

The morph signals (`root`, `burger`) stay flat at the handoff (t=702 -> t=769) and
only start moving on the next frame (t=785). The FAB jumps 0.796 in the SAME
one-frame window. The asymmetry is structural: the morph has
`#dragMorphAtSettleTakeover` (the settle's `startMorph` carries the drag's
terminal value across the handoff); the FAB does not.

**Why the R8-A F1+F3, R9-A F1 boundary, and R10-A F1 tests do not catch this:**

- The R8-A F1+F3 test (`e2e/messages-back-swipe.spec.ts:2231`) drives Phase 2 as a
  240px forward-swipe that COMMITS, ending at a saturated FAB region
  (`releaseBm` past 0.5). For from-only-FAB `fabScale(progress, true, false)`,
  natural(progress past 0.5) = 0 and shifted(progress past 0.5) = `0 + 0 - 0.9`
  clamped to 0. Both yield 0 at the saturated region, so no snap is observed.
- The R9-A F1 boundary test (`e2e/messages-back-swipe.spec.ts:2412`) has a small
  offset (`anchor.scale = 1 - 0.3*0.4 = 0.88`; `natural(anchor.raw=0.12) = 0.76`;
  offset = 0.12). The max observed jump is 0.122, just under the 0.2 threshold.
  Verified empirically that the test's max jump IS the release-boundary snap, but
  the offset happens to be small for the boundary shape.
- The R10-A F1 accelerateInFlight test (`e2e/messages-back-swipe.spec.ts:2607`)
  exercises a discrete-nav interrupt of an enter settle, where the FAB anchor
  mechanism (R10-A F1's `#enterFabAnchor` re-seed) covers the FAB continuity.
  This is the enter-settle path, NOT the gesture-release-settle path.

The defect is reachable in all the scenarios the existing tests do NOT cover: a
re-grab during a non-enter settle (gesture-release settle, mid-settle re-grab,
discrete-nav interrupt of a non-enter drag) followed by a release whose
publication.progress lands in the non-saturated region of the natural formula.

**Severity:** concern (§5 violation, real user-visible snap, narrow but reachable
scenario, missing test coverage for a real code path).

**Fix recommendation:** add a symmetric FAB-side mechanism to
`#armSettleEaseFromGesture` and the discrete-nav arm that captures the drag's
terminal FAB (via `#fabScaleAtSettleInstant` reading the live publication BEFORE
`#armSettleEase` clears `#dragFabAnchor`) into either a new `settleFabStart` field
on the latched record or a new `#settleFabAnchor` orchestrator field. The FAB
layer's scale derivation would then read this anchor during the settle and lerp
from `start` to `dest` (the destination's resting FAB presence) across
`settleMorphFraction`, mirroring `#enterFabAnchor`'s pattern. Add a preventive
no-snap guard in `e2e/messages-back-swipe.spec.ts` that drives the
re-grab-then-cancel scenario above and asserts `maxFrameJumps(fabScale).max < 0.2`
across the full gesture lifecycle (Phase 1 commit + Phase 2 cancel-release).

**Sibling sweep:**

- `#armSettleEaseFromGesture` (line 2946, gesture release): DEFECT (this finding).
  Captures morph via `#dragMorphAtSettleTakeover`; no FAB equivalent.
- `onSvelteKitBeforeNavigate` discrete-nav arm (line 2500, drag-to-discrete-nav
  interrupt): DEFECT (sibling). Captures `liveDragMorph` for the morph tier; no
  `liveDragFab` for the FAB. Same offset snap at the discrete-nav arm's settle
  boundary.
- `playEnterAnimation` (line 1035, commit-to-enter handoff): LEGITIMATE (R8-A F4
  via `#enterFabAnchor`). The settle-side anchor exists for this path.
- `#accelerateInFlight` (line 3245, discrete-nav interrupts enter settle):
  LEGITIMATE (R10-A F1 via `#enterFabAnchor` re-seed from `#fabScaleAtSettleInstant`).
- `notifyHeaderState` mid-settle absorb (line 3449): no dragFabAnchor in flight
  (cleared at the prior arm). Not affected.
- `notifyHeaderState` idle title-change arm (line 3614): no preceding drag
  (`startMorph = atRestMorph(prevHasTabs)`). dragFabAnchor is null. Not affected.

## Out-of-scope observations

- The FAB layer's `displayConfig` (`FloatingActionButtonLayer.svelte:123-144`)
  swaps the icon kind at `publication.progress >= 0.5`. The threshold-based swap
  was designed for the natural `fabScale` midpoint dip (FAB scale = 0 at
  progress = 0.5 for both-FAB shapes). With the `#enterFabAnchor` lerp (R8-A F4),
  the FAB scale stays at 1 across the enter for the both-FAB shape, which would
  make the icon-kind swap visible. The audit's R8-A F4 fix only applies the
  enterAnchor to commit-to-enter handoffs, and the only both-FAB commit-to-enter
  handoff in this app would be a forward-swipe between two FAB routes (which
  doesn't exist in `MOBILE_TABS`), so this concern is unreachable today. It
  becomes a real concern if a future route adds a FAB to `/activity` or similar.
- The `#fabScaleAtSettleInstant` capture guard in `#beginGesture`
  (`nav-pipeline-orchestrator.svelte.ts:1621-1624`) uses
  `this.#publication.inFlight` while the morph capture guard at line 1605-1608
  uses `this.#stateMachine.settleLatched !== null`. The two conditions can
  diverge in the narrow window between `onSvelteKitAfterNavigate`'s land
  (transitions `kind` to `landing`, drops `inFlight`) and the next settle rAF
  tick (which `#endSettleEase`s the still-active settle). In that window a
  re-grab would capture the morph anchor but not the FAB anchor. I could not
  construct a user-visible snap from this asymmetry alone (the FAB layer's
  at-rest branch yields the destination's resting FAB presence, which equals
  what the natural formula would yield at progress=0 of any new plan from the
  destination). Noting for the record; not a separate finding.

## How I sampled the layer

- Read the audit prompt, the spec, the journal R1 through R10 (every entry), and
  the prior audit files RV21-C01-Audit-{01..10}. Confirmed the cycle's continuity
  work covers morph/title/FAB across drag-to-settle, settle-to-drag, and
  commit-to-enter handoffs via shared functions (`#dragMorphAtSettleTakeover`,
  `#fabScaleAtSettleInstant`, `computeFabScale`, `#enterFabAnchor`,
  `#dragFabAnchor`, `#priorTerminalFabScale`, `#settleEasedFraction`).
- Read every touched file end-to-end:
  `src/lib/utils/fab-scale.ts`, `src/lib/utils/header-probe.ts`,
  `src/lib/components/templates/FloatingActionButtonLayer.svelte`,
  `src/lib/components/organisms/Header.svelte`,
  `src/lib/stores/nav-pipeline-orchestrator.svelte.ts` (all 4061 lines, with
  attention to the FAB/morph anchor capture and clear sites, the settle rAF, the
  discrete-nav arm, the publication derived, and the comment accuracy in every
  touched block),
  `src/lib/components/templates/SearchScopePager.svelte`,
  `src/lib/stores/scroll-chrome.svelte.ts`, `scripts/measure-search-jank.ts`,
  `e2e/helpers.ts` (multi-signal sampler, `slowTouchDrag`, animation jank
  analyzer).
- Verified the gate: `bun run check` 0/0; `bun run lint` exit 0;
  `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0.
- Verified the FAB-continuity defect empirically: wrote a temporary probe spec
  modelled on the R8-A F1+F3 test (`e2e/messages-back-swipe.spec.ts:2231`) with
  Phase 2 shortened to 40px (below `SWIPE_COMMIT = 60`, forcing a cancel). The
  probe sampled `fabScale`, `rootLayerTy`, `burgerRot`, `transitionTarget`, and
  `backMorph` every rAF across the full gesture lifecycle and asserted via
  `console.log`. Single run: `fabJumps.max = 0.796` at `t=769ms` (the release
  boundary). The morph signals stayed flat at the same boundary, confirming the
  asymmetry. Deleted the probe before writing this report.
- Cross-checked the FAB anchor coverage at every drag-to-settle site
  (`#armSettleEaseFromGesture`, the discrete-nav arm, `playEnterAnimation`,
  `#accelerateInFlight`, `notifyHeaderState` mid-settle absorb and idle
  title-change arm). Only `#armSettleEaseFromGesture` and the discrete-nav arm
  lack a settle-side FAB anchor.

## Vote

**BLOCK.** One in-scope concern: B-F1 (FAB scale snaps at the drag-to-settle
handoff when `#dragFabAnchor` is in flight and the release lands in the
non-saturated region of the natural formula; §5 violation, probe-verified ~0.8
single-frame snap, missing preventive coverage).

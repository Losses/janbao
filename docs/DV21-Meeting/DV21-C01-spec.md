# DV21 Cycle 1 Spec: DV20 navigation/animation layer UX regression fixes

**Architect:** the document owner. **Executor:** the DV21 Cycle 1 Manager Agent
(CMA). **Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md`.
**Status:** ready for development. **Depends on:** DV20 Cycles 1 to 6 (all
complete and 5/5-converged; master gate green).

## Scope

Fix the five DV20-layer runtime regressions reproduced by
`e2e/reproduce-dv20-drag-sync.spec.ts` and
`e2e/reproduce-dv20-search-swipe.spec.ts`, at their structural root cause, so
each reproduce spec turns green and the full existing e2e suite stays green with
zero flakies. The fixes restore the binding §5 invariant (every visual is a pure
function of the one published progress) across the gesture / header / search
animation layer.

The five fixes (grouped by root cause):

### Fix A: header layers track the live drag (Bugs 1 and 6)

During a HELD back-swipe on a deep page the header root layer (the tab bar
`translateY`, `rootLayerStyle`) and the title layer (`layerDownStyle`) must move
with the finger every frame, driven by the live `backMorph`, exactly as the
BurgerArrowIcon (`iconProgress`) and the page track already do. Today only the
icon and the track move; the two layers stay frozen across the whole drag and
animate only on release. The morph derivation that feeds `rootLayerStyle` /
`layerDownStyle` does not take the live-drag (`backMorph`) branch during a
gesture, even though `iconProgress` does.

### Fix B: discrete back-nav drives the bar-switch concurrently with the slide (Bug 7)

A discrete back navigation (the settings back-button, `Header.onLeftButton` ->
`onBack`) must drive the header bar-switch CONCURRENTLY with the page slide, off
the one slide progress, with no sequential gap. Today the slide ends ~344ms and
the bar-switch starts ~444ms (a ~100ms gap); the morph runs as a post-landing
settle, after the slide. The discrete-nav morph must be driven during the slide
(the same progress that drives the track), not deferred to a post-landing
settle.

**Spec correction (binding).** The DV20-C05b2-spec §5 "Header morph / title
crossfade on a tab-click commit ... runs POST-LANDING" clause is wrong: it
misrepresented the requirement. The morph is part of the one slide progress and
runs concurrently, consistent with §5's one-progress-per-visual rule and with
the gesture-commit case the same spec describes as concurrent. That post-landing
clause is superseded by this spec; auditors must NOT cite it as authority.

### Fix C: forward-swipe Messages -> `/search` (Bug 3)

A committed leftward swipe from `/messages/inbox` (the last tab) must land on
`/search` through the `{tab, search}` resolver (`tabSearchResolver`), with a
real pipeline animation and the root<->search scrub morph, and must never cycle
the Activity or Discussions pill. Today `#nextTabTarget` returns null for the
last tab (no tab index past the last), the boundary fallback cancels, and the
cancel path mis-publishes the pill highlight (Activity and Discussions appear).
Wire the last-tab forward target to `/search`, and stop the boundary/cancel path
from shifting the pill highlight.

### Fix D: search-appear animation must not drop frames (Bug 4)

Under mobile-class CPU (4x throttle) the search-appear animation must present no
render frame above 150ms (the Long-Animation-Frame bar in
`e2e/reproduce-dv20-search-swipe.spec.ts` Bug 4). Today a 190 to 390ms
synchronous chunk in the SvelteKit client bundle runs during the enter. The CMA
profiles the search-appear path (the NavPipelineHost mount on `/search`, the
`SearchScopePager` scope panels, the header scrub morph, the reactive cascade
off the tap-scrub rAF) to locate the heaviest synchronous work and removes or
defers it (lazy-mount, defer non-critical reactive updates, remove layout
thrash) WITHOUT disabling the animation or sacrificing its curve. The fix keeps
the animation playing (the reproduce spec's cadence check fails if it is
disabled).

## End state

1. `e2e/reproduce-dv20-drag-sync.spec.ts` Bug 1 (held back-swipe on a thread)
   and Bug 6 (held back-swipe on `/profile/settings`) are green: the root layer
   and title layer each move with the finger during the held drag.
2. `e2e/reproduce-dv20-drag-sync.spec.ts` Bug 2 stays green (the commit slide is
   already fast and velocity-matched; Fix A removes the residual "sluggish"
   feel, it does not slow the commit).
3. `e2e/reproduce-dv20-drag-sync.spec.ts` Bug 7 is green: the slide and the
   bar-switch overlap (no sequential gap).
4. `e2e/reproduce-dv20-search-swipe.spec.ts` Bug 3 is green: a leftward swipe
   from `/messages/inbox` reaches `/search` with a real animation and no pill
   cycling.
5. `e2e/reproduce-dv20-search-swipe.spec.ts` Bug 4 is green: no render frame
   above 150ms at 4x CPU, animation still playing.
6. `e2e/reproduce-dv20-search-swipe.spec.ts` Bug 5 stays green (boundary guard).
7. The full existing e2e suite (210) is green with zero flakies.

## Constraints (binding)

- **UNIFY, DO NOT BRIDGE.** Each fix aligns the visual with the one published
  progress; no third mechanism. Fix A makes the two header layers read
  `backMorph` during a drag like the icon already does (one fix to the morph
  derivation), not a parallel driver. Fix B drives the discrete-nav morph off
  the slide progress, not a settle that chases it.
- **No CSS transitions. No `setTimeout` in the animation layer.** Anywhere.
- **Root cause + siblings + preventive test.** Each defect is fixed at the
  structural cause. The CMA greps the same bug class across sibling paths
  (e.g. every header visual that should read `backMorph`; every discrete-nav
  path that settles post-landing; every pill-highlight publication site) and
  fixes all in the same change. The reproduce spec is the preventive test.
- **Do NOT regress DV20.** The 24 deep + 3 compose + thread + 3 tab roots +
  `/discussions/pN` + `/offline/*` routes that already work must stay identical.
  The full e2e suite is the regression gate.
- **No git mutation** by the CMA.
- **Comment-accuracy.** Every code comment in touched files describes current
  behaviour (no formerly / old / previously markers; no overclaim about which
  mechanism drives motion). After each `.md` or code-comment edit run
  `grep -P '\x{2014}' <file>` and `bunx prettier --check <file>`.
- **Flakies are defects.** Root-caused, not retried.

## File-level investigation (the CMA confirms the exact sites)

The CMA reads the current code to confirm the root-cause sites before editing.
The expected neighbourhoods (from the DV20 architecture and the reproduce
evidence):

- `src/lib/components/organisms/Header.svelte`: the `morph` derivation and the
  `rootLayerStyle` / `layerDownStyle` reactive bindings (Fix A); the `iconProgress`
  derivation is the reference (it already tracks `backMorph` during a drag). The
  `titleView` crossfade and the settle arming (Fix B).
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts`: the live-drag `#publish`
  (it writes `pager.backMorph` per pointermove; confirm the header layers can read
  it); the discrete-nav path and `#armSettleEase` (Fix B: drive the morph during
  the slide, not post-landing); `#nextTabTarget` (Fix C: the last-tab forward
  target must resolve to `/search`).
- `src/lib/utils/nav-resolvers.ts`: `tabSearchResolver` exists; Fix C wires the
  forward-swipe-from-last-tab gesture into the `{tab, search}` pair.
- `src/lib/components/organisms/MobileTabBar.svelte`: the pill highlight
  publication (`fractionalIndex` / `closeness` / `aria-current`); Fix C stops the
  boundary/cancel from shifting it.
- `/search` enter path: `src/routes/search/+page.svelte`,
  `src/lib/components/templates/NavPipelineHost.svelte`,
  `src/lib/components/templates/SearchScopePager.svelte` (Fix D: profile and
  remove the heavy synchronous chunk; the reproduce spec's LoAF + 4x throttle
  isolates it).

## Migration order

1. Fix A (header drag-desync) first: it is the §5 invariant core and the other
   header fixes build on the morph derivation it corrects. Horizontal grep for
   every header visual that should read `backMorph`.
2. Fix B (discrete-nav concurrency): builds on Fix A's morph-derivation work.
3. Fix C (forward-swipe-to-search + pill cycling).
4. Fix D (search-appear jank): profile-driven; isolate the chunk before editing.
5. After each fix, run its reproduce spec. After all four, run the full gate
   (`bun run check`, `bun run lint`, `bun run test:e2e`).

## Test plan

- The four reproduce specs (Bugs 1, 3, 4, 6, 7) are the preventive tests; each
  must turn green.
- Regression: the full existing e2e suite (210) green, zero flakies.
- Unit tests (`bun test src/lib/...`) green.
- `bun run check` 0 errors / 0 warnings; `bun run lint` exit 0.

## Out of scope

- Bug 2 (commit-slide "sluggish" feel): the commit slide is already
  velocity-matched; Fix A removes the residual feel by syncing the header during
  the drag. No separate commit-duration work.
- Bug 5 (rightward boundary Activity highlight): not reproduced on master across
  80 to 320px; the guard spec stays.
- New features beyond restoring the documented behaviour (e.g. a real-content
  back-preview for `/search`; offline-route variants of these transitions).
- The Bug 4 fix must not disable the animation or coarsen its curve to hide the
  jank (the reproduce spec enforces this).

## Deliverables

- The four fixes (A, B, C, D) at root cause, with sibling sweeps.
- The reproduce specs green; the full e2e green with zero flakies.
- `docs/DV21-Meeting/DV21-C01-Journal.md` (incremental, honest, real outputs).
- Per-round audit reports `docs/RV21-C01-Audit-NN.md`.
- A green gate: `bun run check` 0 errors, `bun run lint` exit 0, full
  `bun run test:e2e` zero failures / zero flakies.

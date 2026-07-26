# DV21 Plan: DV20 navigation/animation layer UX regression fixes

**Status:** Macro plan, ready for Cycle 1. **Architect:** the document owner.
**Protocol:** `docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md` (reused; the
cycle-manager protocol is version-stable across DVs). **Depends on:** DV20
Cycles 1 to 6 (all complete and 5/5-converged; master gate green).

## Background

DV20 refactored the mobile navigation and page-transition animation layer onto a
single global orchestrator + rAF pipeline (the `NavStateMachine` authority, the
executor gesture slide, the settle ease, the tap-scrub ease). The convergence
audits (C05b2 / C05c3 / C06, 5/5 each) judged architectural cleanliness, not
runtime UX behaviour. Five runtime regressions survived that bar. They are
reproduced empirically by the specs in `e2e/reproduce-dv20-drag-sync.spec.ts`
and `e2e/reproduce-dv20-search-swipe.spec.ts`, with the evidence recorded in the
auto-memory note `dv20-refactor-regressions-e2e.md`.

The five regressions:

1. **Header drag-desync.** During a HELD back-swipe on a deep page
   (`/discussion/*`, `/profile/settings`) the page track and the BurgerArrowIcon
   move with the finger, but the header root layer (the tab bar `translateY`)
   and the title layer stay frozen for the whole drag and only animate after
   release. On `/profile/settings`: `backMorph` 0.46, `deepTrackTx` 127px,
   `burgerRot` 82deg all move; `rootLayerTy` / `deepLayerTy` stuck at -40 / 0.
   This violates the DV20 spec's binding §5 invariant (every visual is a pure
   function of the one published progress, written synchronously per
   pointermove).
2. **Missing flagship forward-swipe-to-search.** A leftward swipe from
   `/messages/inbox` stays on `/messages/inbox`, cycles the Activity pill, and
   plays no route animation. DV20-Plan §6 makes the forward swipe from the last
   tab to `/search` (`{tab, search}` -> `tabSearchResolver`) the flagship
   requirement; the orchestrator's `#nextTabTarget` returns null for the last
   tab and the boundary fallback mis-publishes the pill highlight.
3. **Settings back-button two-phase.** Clicking back from `/profile/settings`
   plays the page slide (ends ~344ms) THEN the header bar-switch (starts
   ~444ms): a ~100ms sequential gap, not one concurrent animation. The
   bar-switch itself is smooth; the bug is the sequencing.
4. **Search-appear frame drops.** Under mobile-class CPU (4x throttle) the
   search-appear animation drops frames severely: Long-Animation-Frame entries
   of 164 to 420ms, the offender a 190 to 390ms synchronous chunk in the
   SvelteKit client bundle. A desktop rAF-interval proxy reports "smooth"
   (false negative); CPU throttle + LoAF reproduces it authoritatively.
5. (Bug 1 generalized to `/discussion/*` and `/profile/settings`; see 1 and the
   `only the burger syncs` facet below.)

Reports not reproduced on master (kept as regression guards, not DV21 work):
the commit slide is fast and velocity-matched (its "sluggish" feel is the
drag-desync above); the rightward boundary swipe on `/` is clean across 80 to
320px drag distances.

## Scope

Restore the DV20 §5 invariant end to end across the gesture / header / search
animation layer: every visual (the page track, the FAB, the header morph, the
title crossfade, the tab bar, the BurgerArrowIcon, the search scrub) is a pure
function of the one published progress, written synchronously per pointermove
during a drag and via the orchestrator's settle / tap-scrub rAFs after release.
Wire the flagship forward-swipe Messages -> `/search` path. Remove the heavy
synchronous work from the search-appear animation.

## End state

1. The header root layer and title layer track the live drag progress
   (`backMorph`) frame-by-frame during a held back-swipe, exactly as the
   BurgerArrowIcon already does (`e2e/reproduce-dv20-drag-sync.spec.ts` Bug 1
   and Bug 6 turn green).
2. A committed leftward swipe from `/messages/inbox` lands on `/search` with a
   real pipeline animation and the root<->search scrub morph, never cycling the
   Activity or Discussions pill (`e2e/reproduce-dv20-search-swipe.spec.ts` Bug 3
   turns green).
3. A discrete back-nav from a deep page (the settings back-button) drives the
   header bar-switch CONCURRENTLY with the page slide (one progress), with no
   sequential gap (Bug 7 turns green).
4. The search-appear animation presents no render frame above 150ms under 4x CPU
   throttle, keeping the animation (Bug 4 turns green).
5. The full existing e2e suite (210) stays green with zero flakies; the new
   reproduce specs are the regression gate.

## Constraints (binding)

- **UNIFY, DO NOT BRIDGE.** Each fix aligns the visual with the one published
  progress. No third mechanism bridges the desync. A header layer that does not
  read `backMorph` during a drag is fixed by making it read `backMorph`, not by
  a parallel animation.
- **No CSS transitions. No `setTimeout` in the animation layer.** Anywhere. The
  fixes extend the rAF-driven model; they do not reintroduce CSS or timers.
- **Root cause + siblings + preventive test.** Each defect is fixed at the
  structural cause, the same bug class is grepped across sibling paths and fixed
  in the same change, and the reproduce spec is the preventive test.
- **No git mutation** by the CMA (the cycle manager agent implements and
  reports; the orchestrator gates and audits).
- **Comment-accuracy.** Every code comment in touched files describes current
  behaviour (no formerly / old / previously markers). After each `.md` or
  code-comment edit run `grep -P '\x{2014}' <file>` (no em dashes) and
  `bunx prettier --check <file>`.
- **Flakies are defects.** A flaky e2e is root-caused, not retried.

## Cycle breakdown

- **Cycle 1 (C01): the fixes.** One cycle; the five fixes are the same layer and
  share the §5 invariant. Spec: `docs/DV21-Meeting/DV21-C01-spec.md`. Audit
  prompt: `docs/DV21-Meeting/DV21-C01-Audit-Prompt.md`. The cycle closes at 5
  consecutive PASS votes (two auditors per round, orchestrator-run, clean
  non-leading prompts).

## Execution model

The orchestrator (architect) writes the spec and the audit prompt, runs the
gate, spawns the auditors, tallies, and decides. The Cycle Manager Agent
implements (in fresh-context sub-agents per fix) and writes the journal; it does
NOT audit its own work. Revision and audit history live in
`docs/DV21-Meeting/DV21-C01-Journal.md` and `docs/RV21-C01-Audit-NN.md`, not in
this plan (per the revision-goes-in-the-meeting-journal convention).

# RV20-C05b1 - Audit Round 68 (architect-run, 2 independent auditors)

Result: **A PASS (4 LOW, non-blocking); B PASS-WITH-CONCERNS (1 MED + 1
concern).** Counter stays 0/5.

Both auditors verified UNIFY, the unified following-visual model (every visual is
`f(coverProgress, transitionTarget)`; no per-transition forcing), all five
transition paths, the FAB scale/kind per target, the interrupt handoffs, the
commit/cancel gate, and reduced-motion. Both were run with a clean, role-less,
non-leading prompt that **explicitly forbade reading the Journal and all
`RV20-C05b1-Audit-*.md` files**.

## Fixes

- **B C1 / A C1 (MED/LOW, FIXED) - `unmount()` did not clear the pager store:**
  after a pilot transition settled and the host unmounted, the pager store
  retained the in-flight values (`fractionalIndex: centerTab`, `transitionTarget`,
  `coverProgress: 1`, `active: true`). On landing, the FAB layer re-evaluated
  `fabConfig` to the destination's family and read the stale `fractionalIndex`
  via `tabFraction`, dipping the FAB to scale 0 for the reactive window before
  the destination's `MobileTabPager.onMount` published fresh state (visible under
  slow route-mount timing). B rated this MED with the concrete scenario; A rated
  it LOW (batched, usually invisible). FIX: `unmount()` now publishes a cleanup
  (`fractionalIndex: 0, active: false, ... transitionTarget: null`) matching the
  `onMount` cleanup GPL and MobileTabPager publish, so the FAB falls back to the
  URL-derived tab index until the destination mounts. (R67 had flagged this same
  issue as a LOW and the orchestrator wrongly dismissed it as "theoretical"; B's
  MED + the owner's correction drove the fix.)
- **B C2 (concern, FIXED) - `playEnterAnimation` comment described an unreachable
  case:** "the in-flight position if the enter interrupts another transition"
  cannot occur (the guard above returns if a transition is in flight, and a fresh
  mount constructs a clean executor). FIX: the comment now states the enter
  starts at rest (progress 0) and why there is no in-flight position to continue
  from.
- **R67 A C1 (LOW, carried + FIXED) - the `sawTransition` / `updateFromPathname`
  `$effect`s re-ran every frame of a drag:** they read `publication.plan` /
  `publication.inFlight` on the per-frame publication object. FIX: extracted
  `publicationPlan` / `publicationInFlight` `$derived`s; the plan reference and
  the in-flight boolean are stable mid-transition, so the deriveds memoize and
  the effects re-run only on a real plan/in-flight transition, not each frame.
- **A C2 (LOW, FIXED) - `resetPagerStore` published `fractionalIndex: -1` before
  mount:** the at-rest `$effect` calls it at component init, before
  `mountOrchestrator()` sets `#mountInputs`. FIX: `resetPagerStore` now returns
  early when `#mountInputs === null` (no at-rest state to publish before mount).

## Documented (non-defect / future / scope)

- **A C3 (LOW) - the non-`centerTab` branch of `#republishToPager` is
  unreachable in 5b1:** the pilot always passes `centerTab: 2`. Intentional
  future code for 5b2 deep routes; not dead code. No change.
- **A C4 (LOW) - `initialTrackTransform` is `translateX(-50%)` at SSR, which
  does not match the forward-enter's `translateX(0px)` start:** fine for a
  client-side forward nav (Svelte renders + `onMount` in the same flush, so the
  first paint shows `0px`) and a cold deep-link (`shouldEnter` false, no enter).
  Matches GPL. No change.
- **R67 A C3 (LOW, carried) - the resolver's `buildFabPlan` is computed each
  frame but discarded:** the host passes `fab: null, header: null`; the real FAB
  comes from the FAB layer reading `coverProgress` + `transitionTarget`. The
  plan's fab fn is a placeholder for the future where the driver drives the
  FAB/Header directly (the FAB/Header are not yet unified onto the plan-driven
  path; that is 5b2+). When the FAB migrates to the driver, the fn must use the
  `f(progress, target)` model, not the current from/to-fab-boolean model.
  Documented; not changed in 5b1.
- **R67 B C2 (LOW, carried) - a mid-commit re-grab with a leftward-past-start
  component freezes `coverProgress` at `rawStart`:** narrow edge case, not a
  clear regression vs GPL's own re-grab quirk; the rightward re-grab handoff is
  correct. Architect's scope decision (whether bidirectional mid-commit re-grab
  tracking is in 5b1).

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- messages-back-swipe tab-click-transition tab-exit-preview fab    92 passed
```

Consecutive pass votes: **0** (B carried a MED; fixed + the carried cleanups;
R69 audits the post-fix state).

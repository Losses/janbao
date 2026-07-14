# RV20-C05b2 - Audit Round 26

Result: **A PASS-WITH-CONCERNS (3 CONCERN); B PASS-WITH-CONCERNS (2 CONCERN).**
Counter stays **0/5**. The macro architecture is sound (both auditors verified
the singleton orchestrator, one rAF per channel, NavStateMachine authority, no
CSS transition or setTimeout in the gesture layer, deleted legacy hosts). This
round surfaced two real logic bugs (B) plus a cluster of stale-comment defects
in the e2e suite (A) that earlier rounds missed because the orchestrator-run
grep was scoped to `src/` only.

## B's findings (logic bugs, shared root cause)

Both trace to one root cause: the orchestrator's cleanup path
(`onSvelteKitAfterNavigate`) only runs when the destination is a pipeline route.
When a gesture commit lands on a non-pipeline destination (`/drafts`,
`/categories`, `/category/*`, `/offline/*`, `/discussions/pN`), the singleton is
not active there, `getNavPipelineOrchestrator()` returns null, and the layout's
`afterNavigate` hook skips the cleanup. The transient post-commit state is then
orphaned.

- **B1 (CONCERN, medium, logic bug)** - `#queuedDiscreteNav` leaks. Set by the
  finish-then-new branch when a tab-click arrives during a committing gesture;
  cleared only by `#landAtRest` and `unmount`. On a non-pipeline commit landing
  `#landAtRest` never runs, so the queued nav persists and fires as an
  unexpected `goto` on the NEXT pipeline landing (a phantom redirect to a route
  queued inside a prior, already-completed gesture).
- **B2 (CONCERN, low, logic bug, self-healing)** - a commit settle armed with
  `awaitTitle=true` that lands non-pipeline stays active; `configure`'s
  `forceReset` resets only the macro phase, not the settle `$state`, so the
  publication emits a stale morph for one render flush on the next pipeline
  route, then self-heals via `notifyHeaderState`.

The orchestrator verified both independently by reading `configure`
(`forceReset` resets `#state` only, not the settle fields), `releaseInputs`
(clears `#pendingDiscreteNav` but not `#queuedDiscreteNav`, and intentionally
does not end the settle), `#landAtRest` (fires the queued nav unconditionally),
and the layout hook (skips `onSvelteKitAfterNavigate` when the orchestrator is
not active). Both are real and reachable (back-swipe from a pipeline route to a
non-pipeline previous entry, plus for B1 a tab tap during the commit slide).

### Fix (B1 + B2, unified)

B's suggested "configure clears the leaked fields" would break the legitimate
pipeline-landing finish-then-new: `configure` (destination host `onMount`) runs
BEFORE `#landAtRest` (afterNavigate), so clearing `#queuedDiscreteNav` in
`configure` would discard the tab-click replay, and ending the settle there
would cut the title crossfade.

The correct boundary is the dispatch site. In `#onExecutorSettle`'s commit path,
when the dispatch target is a non-pipeline route, the orchestrator clears the
transient state the landing hook would have consumed:

```ts
if (!isNavPipelineRoute(target)) {
	this.#queuedDiscreteNav = null; // B1: replay impossible on non-pipeline
	this.#endSettleEase(); // B2: await cannot resolve without the hook
}
```

Pipeline targets skip this branch, so their landing fires `#landAtRest`
(consumes the queued nav, ends the settle) unchanged. The settle ease has
already morphed the title across the commit slide by the time `#onExecutorSettle`
runs, so ending it here is seamless. (`isNavPipelineRoute` newly imported from
`$lib/utils/nav-pipeline-gate`.)

Known limitation: on the non-pipeline commit-target edge case the queued
tab-click is discarded (the finish-then-new replay cannot run on a non-pipeline
route). This is the minimal correct behavior; the alternative (firing a second
`goto` immediately after the commit dispatch) races with the commit landing. The
phantom-redirect bug is eliminated.

### Test feasibility

B1/B2's scenario (a gesture commit to a non-pipeline target with a tab tap
mid-commit) is timing-dependent and hard to drive deterministically in e2e, and
the orchestrator's `.svelte.ts` runes class cannot be loaded by `bun:test`
(no runes loader). The fix is verified by reasoning (the branch fires only for
non-pipeline commit targets; pipeline targets are unaffected; `#endSettleEase`
is safe to call when settle is inactive) and by the full regression e2e (no
behavioral change for pipeline routes).

## A's findings (stale comments in e2e + one atom)

These survived earlier rounds because the R24 sibling grep searched `src/` only
and missed `e2e/`. The orchestrator's repo-wide grep this round found the full
set (A's three plus siblings: `MobileTabPager`, the deleted `.fab-transition`
class, the deleted "Family A sampler" / `sampleFraction`).

- **A1 (CONCERN)** - `e2e/fab-boundary-swipe-sync.spec.ts` docstring described
  `MobileTabPager`, the FAB "Family A sampler", and `sampleFraction` (DOM
  read-back). Rewritten to describe the orchestrator publishing
  `trackFractionalIndex` / `fractionalIndex` and the FAB layer as a reactive
  reader.
- **A2 (CONCERN)** - eight `MobileTabPager` references across six e2e files
  (`tab-data-root-load`, `header-hide-on-scroll`, `swipe-back-pill-flicker`,
  `swipe-forward-back-deep-page`, `helpers.ts` x2). Rewritten to name the
  current hosts (`NavPipelineTabHost` / `NavPipelineHost`) and the orchestrator
  publication.
- **A3 (CONCERN)** - `FloatingActionButton.svelte` docstring said motion is
  driven by "a rAF on the layer", implying the FAB layer runs its own rAF.
  Rewritten: motion is driven by the orchestrator's per-frame publication; the
  layer is a reactive reader and the atom has no transition directive.
- Sibling cleanup: the `.fab-transition` references (the class was deleted). In
  `fab.spec.ts` the `hasTransition` / `.fab-transition` assertion block was
  tautological (the deleted class can never be present) and was removed; the
  "no CSS transition on the FAB" invariant is now structural. The `FabFrame.tr`
  and `FabTransitionCapture.transitionFrames` probe fields in `helpers.ts`
  (which existed only to feed the deleted-class check) were removed after
  confirming no remaining consumers. The "Family A sampler" comment in
  `tab-host-swipe.spec.ts` was rewritten.

A repo-wide grep confirms zero remaining references to `MobileTabPager`,
`GesturePageLayout`, `fab-transition`, `sampleFraction`, `Family A sampler`, or
`discreteNavInFlight` in `src/` or `e2e/`. (The only residue is in `docs/`
historical records, which are `.md` nitpick territory.)

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    408 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:430,
                                     "Family B back: thread -> list", the
                                     pre-existing CDP touch flake; line shifted
                                     442 -> 430 from the assertion removal)
```

e2e identical to the pre-fix state. No behavioral regression.

R27 audits the post-R26-fix state.

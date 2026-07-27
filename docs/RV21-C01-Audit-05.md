# RV21-C01 Audit 05 (R5)

**Date:** 2026-07-27. **Round:** R5. **Counter after:** 0/5 (auditor A BLOCK).
**Gate at audit time:** `bun run check` 0/0; `bun run lint` exit 0; `bunx tsc
-p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0; sibling e2e sets
green per the R4/R5 journal.

R5's F2/F3 unskip made the re-grab and gesture-during-forward-enter handoffs
continuous at the drag side (the `#dragMorphAnchor` capture + the decoupled
`#settleEasedFraction`). This audit found a NEW §5 snap on the OTHER side of
the same anchor mechanism: the drag-to-discrete-nav handoff. The anchor is
captured correctly when a drag takes over a settle, but the discrete-nav arm
in `onSvelteKitBeforeNavigate` ignores it and captures the natural morph,
so the morph derivation snaps from the anchor-shifted drag value to the
natural settle start value in one rAF frame.

## Finding (single, BLOCK)

### F1 (R5-A, §5 + stale comment): morph snap at the drag-to-discrete-nav handoff when `#dragMorphAnchor` is set

**Class.** Capture-the-drag-terminal-morph sites that should apply the
`#dragMorphAnchor` shift but do not. Sibling of the R4/R5 gesture-release
fix; the R5 sub-agent updated `#armSettleEaseFromGesture` to use the new
`#dragMorphAtAnchorOrRaw` helper but missed the discrete-nav arm.

**Site.** `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:2421-2422`:

```ts
const raw = this.#publication.progress;
const startMorph = this.#dragMorphAtRaw(outgoingHasTabs, raw);
```

This is the only `startMorph` capture site that still uses `#dragMorphAtRaw`.
The gesture-release arm at L2766 was updated in R4 to call
`#dragMorphAtAnchorOrRaw`; this site was not.

**Concrete failure scenario** (probed empirically, two independent runs):

1. Forward-enter to a centerTab thread route (`/messages/inbox` ->
   `/messages/<id>`) arms a settle with `startMorph = destMorph =
atRestMorph(true) = 1`.
2. A rightward back-swipe started mid-enter (`#beginGesture`) captures
   `dragMorphAnchor = { morph: <settle morph at takeover>, raw: <new plan
rawStart> }` per the R5 Stage-1 two-phase capture. The Header's drag
   branch then renders the anchor-shifted morph
   `anchor.morph + natural(bm) - natural(anchor.raw)` (clamped).
3. While that drag is still live (finger down, anchor set, drag morph
   non-trivial), a tab-click (or any SvelteKit navigation that satisfies
   the discrete-nav branch's guards: target is a tab root or a deep-to-deep
   detail, from is the host route) arrives. The executor is in the `'live'`
   phase, so the `phase === 'committing'` accelerate branch (L2248) is
   skipped and control reaches the discrete-nav arm at L2406-2437.
4. `#cancelAllAnimationEases` (L2267) ends the in-flight settle rAF;
   `#dragMorphAnchor` is NOT cleared (only `#armSettleEase` clears it, at
   L2566, AFTER the capture).
5. The capture reads `#publication.progress` (still the drag's raw) and
   computes `startMorph = #dragMorphAtRaw(outgoingHasTabs, raw)` -> the
   NATURAL morph `currentHasTabs ? 1 - raw : raw`. The Header was rendering
   the SHIFTED value at the same `bm`, so the new settle's `startMorph`
   disagrees with the drag's terminal morph by
   `anchor.morph - natural(anchor.raw)` (clamped).
6. `#armSettleEase` (L2437) clears `#dragMorphAnchor` and arms. On the next
   flush the morph derivation switches from drag branch (shifted) to settle
   branch (natural startMorph). SNAP in one rAF frame.

**Empirical evidence** (temporary probe spec, since deleted: forward-enter
to `/messages/<id>`, mid-enter rightward swipe 240px in 10 steps, 40ms gap,
`a[data-tab-nav][href="/"]` click via `page.evaluate`, touchEnd; multi-signal
sampler on `burgerRot` / `rootLayerTy`):

| run | maxBurgerJump (deg) | maxRootJump (px) | at t (ms) | finalPath |
| --- | ------------------- | ---------------- | --------- | --------- |
| 1   | 102.78              | 22.84            | 844       | `/`       |
| 2   | 101.67              | 22.59            | 824       | `/`       |

Both well above the per-rAF cadence (~22deg / ~12px at this viewport) and
the existing no-snap thresholds (35deg / 15px).

**Control** (probed and deleted): the same scenario without the prior
forward-enter (a from-rest drag, no anchor captured) snaps only
~17.5deg / ~3.9px - within cadence - confirming the anchor is the cause.

**Reachability.** A tab-click during a live drag is unusual but real:
multi-touch (one finger swiping the content, another tapping a tab in the
Header's persistent `MobileTabBar`), a programmatic `goto` from app code
firing `beforeNavigate` mid-drag, or a `popstate` from a browser back
gesture. The discrete-nav branch's own comment (L2314-2318) anticipates
this case ("an opposite-direction tab-click arriving mid-finger-drag").
The §5 invariant the cycle targets has no rarity carve-out: "continuous at
EVERY gesture boundary".

**Stale comment** (same site, L2412-2420):

```
// Capture the morph at the arm instant: if a live drag was
// interrupted (the executor was in the 'live' phase when the
// discrete nav arrived), `#publication.progress` still holds
// the raw drag fraction and the Header's morph was reading the
// drag branch (`currentHasTabs ? 1 - raw : raw`). Otherwise
// (`#publication.progress === 0`) this collapses to the
// source's at-rest morph. Either way the settle continues from
// the morph value the Header was rendering (DV21 §5: no snap
// at the discrete-nav interrupt handoff).
```

The claim "the Header's morph was reading the drag branch
(`currentHasTabs ? 1 - raw : raw`)" is false when `#dragMorphAnchor` is
set (re-grab, gesture-during-forward-enter): the drag branch is the
SHIFTED formula `anchor.morph + natural(bm) - natural(anchor.raw)`, not
the natural one. The closing "Either way the settle continues from the
morph value the Header was rendering (DV21 §5: no snap)" is the
over-claim the empirical snap disproves. Per the audit prompt's
"code-comment accuracy is ALWAYS a concern", the comment alone is
sufficient to BLOCK even if the behaviour were unreachable.

**Severity:** concern (a user-visible one-frame snap of the icon and the
tab bar at the discrete-nav interrupt, plus the inaccurate code comment
that claims the opposite).

**Fix for R6 (CMA).** Change L2422 to call `#dragMorphAtAnchorOrRaw` for
symmetry with `#armSettleEaseFromGesture`:

```ts
const startMorph = this.#dragMorphAtAnchorOrRaw(outgoingHasTabs, raw);
```

Safe by construction: when `#dragMorphAnchor === null` (no prior
settle-to-drag handoff) the helper returns the natural morph unchanged
(identical to `#dragMorphAtRaw`); the shift only applies when an anchor is
in flight. After the fix, rewrite the comment to drop the
`currentHasTabs ? 1 - raw : raw` claim and document the
anchor-shifted-drag case (mirroring the Header.svelte drag-branch comment
at L199-226). Add a preventive no-snap guard in
`e2e/messages-back-swipe.spec.ts` modelled on the F2/F3 tests: forward-enter
to `/messages/<id>`, mid-enter rightward swipe past the engage threshold,
fire `a[data-tab-nav][href="/"]` click mid-drag, assert
`maxFrameJumps < {burger: 35deg, root: 15px}` across the handoff.

**Sibling sweep.** Enumerated every `startMorph` capture site in the
orchestrator:

- `onSvelteKitBeforeNavigate` discrete-nav (L2422): DEFECT (this finding).
- `#armSettleEaseFromGesture` (L2766): correct (`#dragMorphAtAnchorOrRaw`).
- `playEnterAnimation` (L1088): correct (`#atRestMorph`, no preceding drag
  for a fresh enter).
- `notifyHeaderState` mid-settle absorb (L3183): correct
  (`#morphAtSettleInstant(prevLatched)`; the prior settle's morph is the
  in-flight value, not a drag-terminal value).
- `notifyHeaderState` idle title-change arm (L3311): correct
  (`#atRestMorph`, no preceding drag at an idle title change).
- `#accelerateInFlight` (L2983): correct (`#morphAtSettleInstant`; only
  reached while `phase === 'committing'`, where the drag has already
  released and `#armSettleEaseFromGesture` cleared the anchor).

Only one defective site.

## Sampling notes

- Read the full current `Header.svelte` morph / iconProgress / searchProgress
  / trackMorph / tabProgress / rootLayerStyle / layerDownStyle derivations
  and the DEV probe; the `BurgerArrowIcon` `progress` prop; the
  orchestrator's `#beginGesture`, `#armSettleEase`,
  `#armSettleEaseFromGesture`, `#accelerateInFlight`, `notifyHeaderState`
  mid-settle absorb / idle title-change arm, `playEnterAnimation`,
  `#republishToPager`, `#dragMorphAtRaw` / `#dragMorphAtAnchorOrRaw`,
  `#morphAtSettleInstant`, the `OrchestratorPublication` field docstrings,
  and the publication's `settleMorphFraction` / `settleEasedFraction`
  chain; the FAB scale across a forward-swipe-to-`/search`
  (`suppressSlide` branch + `fabScale(true, false)`).
- Probed boundaries: re-grab during a centerTab settle, then a tab-click
  mid-drag (F1 above). Cancel-slide of the deep/tab shape, pointercancel
  during a settle, boundary void-swipe FAB reaction, deep<->search,
  /search<->tab-root discrete nav, and the FAB scale across a
  forward-swipe-to-/search all sampled by reading the code; no defect
  found in those (the FAB reacts via `fabScale(progress, true, false)`
  because `/search` is tag 'search', not 'tab', so the suppressSlide
  branch's `tag === 'tab'` guard correctly excludes it; the
  publication-driven FAB is a pure function of progress).
- Did not run the full e2e (orchestrator's gate); ran `bun run check` and
  `bun test src/lib` (552/0).

## Out-of-scope observations (nitpicks, do NOT block)

- The Header.svelte drag-branch comment (L184-196) calls the null
  publication "the only null publication is a tab-to-tab swipe ... on any
  host type", which is loose: a centerTab tab-to-tab swipe (e.g.
  `/messages/<id>` -> `/messages/inbox`, both pill-map to messages)
  publishes non-null via the centerTab branch. The first part of the same
  comment does say "centerTab threads alike" publish non-null, so a reader
  can reconcile, but the "on any host type" qualifier is imprecise.
  `.svelte` comment; flagged as a concern-class nitpick only because the
  R3 sweep already considered this wording acceptable and the surrounding
  comment does document the centerTab exception.
- A possible forward-enter arm snap (`playEnterAnimation` captures
  `startMorph = atRestMorph(outgoing)` while the morph derivation's at-rest
  branch returns `atRestMorph(currentHasTabs = destination)` between the
  URL landing and the arm) is NOT in this cycle's R1+R4 scope (it is not a
  gesture-release or re-grab handoff); recorded for a future cycle if
  empirically confirmed. Not probed here.
- The 6 pre-existing `e2e/tsconfig.json` errors (pre-date this cycle).

## Auditor B findings (consolidated into this round)

Auditor B voted BLOCK on two stale-comment concerns (behaviour confirmed correct,
gates green):

- **B-F1**: `#republishToPager` function docstring (`nav-pipeline-orchestrator.svelte.ts` ~L3545-3563) claims "two tab-host sub-cases" but there are THREE (it omits the forward-last-tab-to-`/search` reach path Fix C added), and claims deep-page mode "always publishes `rawDragFraction`" (the offline-LIST-to-tab sub-case publishes `null` because `fromIdx >= 0 && toIdx >= 0`). The inline "four sub-cases" count (~L3605) is also stale (five actual).
- **B-F2**: `e2e/offline-back-swipe.spec.ts` F1 preamble describes the R4 formula (`targetIsSearch || isTabToTab`) rather than the R5 refinement (`targetIsSearch || (isTabToTab && !isCenterTabRoute)`), and claims "every tab-to-tab shape captures `startMorph = atRestMorph(outgoingHasTabs)`" (wrong for the centerTab tab-to-tab shape, which captures `#dragMorphAtAnchorOrRaw`).

## Counter after R5: 0/5 (both auditors BLOCK).

## Fix for R6

1. **A-F1 (§5)**: the discrete-nav startMorph capture (`nav-pipeline-orchestrator.svelte.ts:2422`) must use `#dragMorphAtAnchorOrRaw(outgoingHasTabs, raw)` (not `#dragMorphAtRaw`) so a discrete nav interrupting an anchor-shifted drag continues from the visual the Header was rendering. Rewrite the stale comment at L2412-2420. Add a no-snap guard (a programmatic `goto` / tab-click fired mid-drag via the `__e2eGoto` hook or a tab-tap during a held drag, sampling `burgerRot`/`rootLayerTy`).
2. **B-F1**: rewrite the `#republishToPager` docstring (three tab-host sub-cases incl forward-to-`/search`; the offline-LIST-to-tab `null` exception under deep-page mode) and the "sub-cases" count.
3. **B-F2**: rewrite the `offline-back-swipe.spec.ts` F1 preamble to the R5-refined formula + the centerTab exception.

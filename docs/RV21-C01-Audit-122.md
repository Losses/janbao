# RV21-C01 Audit 122 (R122)

**Date:** 2026-08-04. **Round:** R122. **Votes:** auditor A PASS,
auditor B PASS. **Counter after: 1/5.**

## Outcome

First earned double-PASS of the R119-R122 run (R119, R120, R121 were all
BLOCK). Both auditors did exhaustive, independent, deep sweeps (A: 182
tool uses; B: 169 tool uses) and found zero in-scope concerns.

Both re-derived the prior fixes against the FULL caller set rather than
trusting prior-round endorsements (the R121 lesson):

- **R121 `#atRestMorph` fix** -- both re-walked all 6 listed callers
  (playEnterAnimation, the discrete-nav arm at ~2958, #armSettleEaseFromGesture,
  the #dragMorphAtSettleTakeover from-rest fallback, the notifyHeaderState
  mid-settle absorb, the idle arm) and confirmed each passes a route
  tab-ness, never drag state; the new justification ("a pure function of
  tab-ness, independent of any drag state") holds for all.
- **drag-terminal class (R119-R120)** -- both re-derived every remaining
  `terminal`-family hit (39 across src/lib + e2e) and concurred: all are
  gesture-release / saturated-raw=1 / constant-0 isDeepToDeep /
  commit-destination / FAB-epsilon. Genuinely exhausted.
- **"no live drag" / "owns the morph" class (R121)** -- all 12 remaining
  hits context-qualified; the only universal claim was the one R121 fixed.

## Depth checks both performed

- §5 invariant: no CSS `transition:` or animation-layer `setTimeout`
  reintroduced. The only `setTimeout`s in scope (Header search-input
  debounce, NavPipelineTabHost IDB-write deferral) are explicitly
  out-of-§5 per their comments. Three rAF channels (executor / settle /
  tap-scrub) own disjoint visual sets.
- Fix A/B/C/D implementations match the spec.
- Dead-export sweep: every export of header-probe.ts, fab-scale.ts,
  nav-resolvers.ts has importers.
- No `formerly`/`old`/`previously` past-state markers; no TODO/FIXME/HACK.

## Notable: A traced a latent §5-snap reachability

A investigated the Header's `if (isDeepToDeep) return 0;` short-circuit
(Header.svelte:~162), which ignores `#dragMorphAnchor` and would snap IF
a morph-animating prior settle could be interrupted by an isDeepToDeep
re-grab. A traced the reachability: the re-grab's target is
`resolvedLeftHref` (prefers `previousEntryPathname()`), and for a user who
just landed on a deep page from a tab (the only way to have a tab->deep
settle in flight), the previous entry IS the tab root, so the new drag is
deep->tab, not deep->deep. The short-circuit is unreachable from a
morph-animating prior settle; safe. This is the depth the convergence
requires (a shallow PASS would have missed this latent concern).

## Out-of-scope observations (both auditors, non-blocking)

- `e2e/messages-back-swipe.spec.ts:1556` "the settle's terminal value at
  the release instant" -- awkward English (B), but the sentence's logical
  claim (drag formula agrees with the settle's value at release, diverges
  mid-commit) is correct and contextually disambiguated. Not a concern.
- `DualColumnLayout.svelte:297` CSS `transition` -- desktop slogan hover,
  out of the mobile nav layer.
- Header search-input debounce `setTimeout` (Header.svelte:693) --
  explicitly out of the §5 bar.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib/stores
src/lib/utils` 398/0; prettier clean; no U+2014. No code change this round.

## Disposition

Counter after R122: 1/5. The drag-terminal class (R119-R120, 20 sites)
and the #atRestMorph justification class (R121, 1 site) are both
exhausted and re-verified independently by two deep auditors. Four more
consecutive double-PASSes needed to close (5/5).

**No git mutation.** No commits, no branches, no pushes.

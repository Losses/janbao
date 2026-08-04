# RV21-C01 Audit 123 (R123)

**Date:** 2026-08-04. **Round:** R123. **Votes:** auditor A PASS,
auditor B PASS. **Counter after: 2/5.**

## Outcome

Second consecutive earned double-PASS (R122 + R123). Both auditors did
exhaustive, independent deep sweeps (A 160 tool uses; B 243) and found
zero in-scope concerns. Convergence is holding: the same classes
re-verified clean by fresh eyes each round.

## Re-derivation (both auditors, not trusting prior endorsements)

- **R121 `#atRestMorph` fix** -- both re-walked all 6 callers; each
  passes route tab-ness, never drag state. Justification holds.
- **drag-terminal class (R119-R120)** -- both re-derived all 39+
  remaining `terminal`-family hits across `src/lib` + `e2e`; concurred
  all are gesture-release / saturated-raw=1 / constant-0 isDeepToDeep /
  commit-destination / FAB-epsilon / DragMorphAnchor symmetric-reference.
- **"no live drag" / "owns the morph" (R121)** -- all remaining hits
  context-qualified.
- **Header `isDeepToDeep` short-circuit (Header.svelte:162)** -- both
  re-traced reachability from a morph-animating prior settle and confirmed
  it unreachable (deep-to-deep hardcodes morph=0, so no morph-animating
  settle is ever deep-to-deep; the re-grab resolves to the tab root).

## Caller counts independently re-derived (B)

`#enterFabAnchor` 5, `#searchAnchor` 5, `#fabScaleAtSettleInstant` 6,
`#searchProgressAtSettleInstant` 6, `#morphAtSettleInstant` 3,
`#dragMorphAtSettleTakeover` 2 -- all match the journal's 5/5/6/6/3/2.

## New depth checks this round

- **A** ran a universal-claim sweep over `the only` / `never` / `always` /
  `wherever` / `exactly one` / `single source` (43+ orchestrator, 12
  Header, 5 header-probe) and re-derived each against its caller set --
  none overclaims.
- **A** investigated `#searchProgressAtSettleInstant`'s "tap-scrub clause
  omitted" justification (the capture sites fire during drag / commit /
  enter settle, never a tap-scrub). Walked the concurrent tap-scrub+settle
  scenario (`/` -> `/search` arms both); confirmed `pager.tapMorph` is
  unreachable from the helper (the `!pub.inFlight` guard returns null
  first, and no dynamic-title search route exists). Conclusion correct.

## §5 + Fix A/B/C/D (both)

No CSS `transition:` in the animation layer; the only `setTimeout`s in
scope (Header search-input debounce, NavPipelineTabHost IDB-write
deferral, +layout scroll-chrome hold-through) are explicitly out-of-§5
per their comments. Three disjoint rAF channels. Fix A/B/C/D implemented
at root cause and match the spec. No dead exports (`lastGestureMorph`
vestigial but documented). No past-state markers, no TODO/FIXME/HACK.

## Out-of-scope observations (both, non-blocking)

- `DualColumnLayout.svelte` CSS transitions (desktop slogan hover, mobile
  drawer) -- separate UX, not the page-transition layer.
- `e2e/messages-back-swipe.spec.ts:1556` awkward-but-contextually-accurate
  phrasing (carried from R122).

## Verify

`bun run check` 0/0; `bun run lint` exit 0; `bun test src/lib/stores
src/lib/utils` 398/0; prettier clean; no U+2014. No code change this round.

## Disposition

Counter after R123: 2/5. Three more consecutive double-PASSes needed
(R124, R125, R126) to close at 5/5.

**No git mutation.** No commits, no branches, no pushes.

# RV21-C01 Audit 01 (R1)

**Date:** 2026-07-26. **Round:** R1. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** lint red (`scripts/measure-search-jank.ts`
failed prettier + eslint; fixed by the orchestrator to exit 0 during the round);
`bun run check` 0/0; `bun test src/lib` 552/0; full e2e 217/0 (implementation
gate, before the audit fixes).

Both auditors independently BLOCKed on the same root defect (a §5 morph
discontinuity at the drag to settle boundary), plus stale comments and a
missing preventive test. The two auditors explored from different angles and
converged, which raises confidence in the finding.

## The core defect: morph discontinuity at the drag to settle boundary (§5)

`src/lib/components/organisms/Header.svelte` `morph` `$derived.by`. The drag
branch and the settle branch use formulas that disagree at the release
handoff, so `morph` (and every visual that reads it: `iconProgress`,
`rootLayerStyle`, `layerDownStyle`) snaps in a single rAF frame at release.
Both auditors verified this empirically with temporary probes.

Two sibling instances (a class, not one site):

- **(a) centerTab to tab-root back-swipe** (`/messages/<id>` to `/messages/inbox`,
  introduced by Fix A's centerTab `backMorph` publication). Drag morph `1 - bm`;
  settle morph collapses to the constant `1` (`outgoingHasTabs === incomingHasTabs
=== true`). At release the icon snaps `bm*180deg` to `0deg` and the tab-bar
  `translateY` snaps `-bm*100%` to `0%`. Verified: rotation 82.44deg at t=853ms,
  0deg at t=879ms while `bm` was still 0.4582. (The Fix A CMA flagged this
  residual in the journal; the auditor confirmed it.)
- **(b) targetIsSearch forward-swipe** (`/messages/inbox` to `/search`,
  introduced by Fix C). Drag morph `1` (the `targetIsSearch` skip); settle morph
  `1 - sp` (`outgoingHasTabs=true`, `incomingHasTabs=false` for `/search`).
  At release the icon snaps `0deg` to `~119deg` and the tab-bar `translateY`
  snaps `0%` to `-66%`. Verified: rotation 0deg / rootLayerTy 0px at t=1301ms,
  119.08deg / -26.46px at t=1338ms while `bm` was still 0.6616.

The deep to tab case the spec primarily targets is continuous (drag `bm`,
settle `sp`, equal at `sp=bm`); deep to deep is constant 0 at both endpoints;
bidirectional tab to tab publishes `backMorph: null` so both branches return the
same constant. Only the two shapes above snap.

**Severity:** concern (§5 violation; a user-visible one-frame snap of the icon
and the tab bar at the release instant). The journal's claim that "the settle
ease armed at release returns morph to the destination's tab-ness" is wrong for
these shapes (the formula collapses to a constant, so the return is a snap).

## Stale comments (concerns, code-comment accuracy)

- `e2e/reproduce-dv20-drag-sync.spec.ts:94-96`: claims `backMorph` is null on
  centerTab routes so the track translateX is the engagement signal; Fix A made
  the centerTab branch publish `backMorph: rawDragFraction`, and the test's own
  assertions depend on the non-null morph.
- `src/lib/stores/nav-pipeline-orchestrator.svelte.ts:237-244`: the
  `PipelineMountInputs.centerTab` docstring claims the orchestrator publishes
  `backMorph: null, fractionalIndex: centerTab (constant)` and the Header
  "stays in root mode end to end"; Fix A changed all of that (non-null backMorph,
  interpolating fractionalIndex, the morph moves).
- `src/lib/components/organisms/Header.svelte:159-166`: the `targetIsSearch`
  skip comment claims "no diagonal motion" and "covers the ENTER direction"; it
  covers only the drag phase, and the commit-slide settle branch produces exactly
  the diagonal motion the comment denies.

## Missing preventive test (concern, low)

`e2e/reproduce-dv20-search-swipe.spec.ts` Bug 3 uses the multi-signal sampler
(which already records `rootLayerTy`, `deepLayerTy`, `burgerRot`) but asserts
only the horizontal track, the pill sequence, and the landing URL. It does not
guard the vertical-channel morph continuity that Concern (b) breaks, so the
defect shipped.

## Fixes applied this round (orchestrator)

- `scripts/measure-search-jank.ts` prettier + eslint (`no-restricted-syntax`:
  no `as unknown`, no inline type literals): rewritten to named interfaces + a
  named `LoafWindow` cast. `bun run lint` now exit 0.

## Fixes for R2 (CMA)

- Make the morph continuous across the drag to settle handoff for every gesture
  shape (capture the morph value at release; interpolate the settle morph from
  that start value to the destination, so it never collapses to a constant that
  disagrees with the drag branch). This fixes both sibling instances (a) and (b).
- Rewrite the three stale comments to current behaviour.
- Add the vertical-channel morph-continuity guard to the Bug 3 spec (and a
  centerTab to tab-root guard to the messages-back-swipe / a sibling spec), so
  the snap cannot ship again.

## Out-of-scope observations (nitpicks, recorded)

- Journal `.md` wording ("returns morph to the destination's tab-ness", "no
  diagonal motion", "iconProgress reads 0 end to end") is inaccurate for the
  commit-slide phase; `.md`-only, nitpicks.

# RV21-C01 Audit 127 (R127)

**Date:** 2026-08-05. **Round:** R127. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

A and B BLOCKed on TWO DIFFERENT findings (both the over-narrow/overclaim
class). Counter resets to 0/5 (R126's pass wiped -- the bar correcting a
premature PASS, as in R124).

## Finding A -- `FloatingActionButtonLayer.svelte:118-122` (displayConfig)

The `displayConfig` docstring said the kind-swap at the visual midpoint is
"(matching the scale's dip-to-0 at the midpoint)." The scale dips to 0 at
progress=0.5 ONLY for the natural `fabScale` formula (branch 5); the
layer-level docstring at lines 22-24 explicitly qualifies this ("The
boundary / suppressed / enter-anchor / drag-anchor branches override the
natural formula"). The displayConfig docstring dropped that qualifier.
The kind-swap (fires at `pub.progress >= 0.5`) IS reachable during a
branch-3 enterAnchor-lerp release (a re-grab into a both-have-FAB
cross-kind transition), where the scale at midpoint is ~0.96, not 0 -- so
the "dip-to-0" rationale is wrong for that reachable case.

Fixed: qualified to "(the natural `fabScale` formula dips to 0 at the
midpoint, hiding the swap; the enter-anchor / drag-anchor branches
override the natural formula and may leave the swap visible)."

## Finding B -- `orchestrator:508` (`#commitStartRaw` backMorph parenthetical)

The docstring's apposition "(deep-page / backward-to-deep-page Header
morph)" defined `backMorph` by only 2 of its morph-driving paths. The
Header's OWN morph-derivation comment (line 207-209) enumerates the
comprehensive set: "deep page, compose, and centerTab threads alike ...
backward-to-deep, forward-last-tab-to-/search." The centerTab-thread path
(reachable on every back-swipe on `/messages/<id>` or `/discussion/<id>`,
where `morph = 1 - bm`) was omitted. Same over-narrow class as R120/R121/
R124/R125.

Fixed: replaced the partial enumeration with the non-enumerative
"(the Header morph signal published during a drag)" -- accurate for every
drag-driving route, no over-narrow.

## Why R126 missed both

R126 re-derived the multi-path fields' VALUE enumerations (the
`#commitStartRaw` commit/cancel TYPE cases; the helper caller counts) but
did not re-derive (A) the FAB displayConfig's dip-to-0 RATIONALE against
the branch set, nor (B) the `#commitStartRaw` backMorph APPOSITION against
backMorph's full morph-driving path set. R127's auditors re-derived those
two sub-properties. The class keeps surfacing because each field has
multiple sub-properties (value enumeration, rationale, apposition), and
each round's re-derivation covers a slightly different sub-property set.

## Orchestrator proactive sweep

After the 2 fixes, grepped for sibling signal-definitional parentheticals
(`` `X` (`` appositions naming driving paths) across the orchestrator,
Header, header-probe, fab-scale, FAB layer. Verified:

- `orchestrator:4792` "backMorph (the deep-page morph for a backward
  gesture; ... scrub for a forward last-tab gesture)" -- context-scoped to
  the `holdPillAtFromIdx` branch's 2 reach paths (backward-to-deep,
  forward-last-tab-to-/search); accurate (B concurred in R127).
- `orchestrator:838` / `header-probe.ts:166` "`settleTargetProgress`
  (commit -> incoming, cancel -> outgoing)" -- maps settleTargetProgress's
  2 values correctly. Accurate.
  No new over-narrow parentheticals.

## Verify

`bun run check` 0/0; `prettier --check` clean on both edited files; no
U+2014 em-dash; comment-only changes.

## Disposition

Counter after R127: 0/5. The over-narrow/overclaim class has now produced
7 instances (R120, R121, R124, R125, R127-A, R127-B, + rawStart). Each
deep audit that re-derives a NEW sub-property (value vs rationale vs
apposition) finds one more. Convergence requires re-deriving EVERY
sub-property of EVERY multi-path field, not just the value enumeration.

**No git mutation.** No commits, no branches, no pushes.

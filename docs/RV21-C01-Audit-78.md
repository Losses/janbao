# RV21-C01 Audit 78 (R78)

**Date:** 2026-08-01. **Round:** R78. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

A new audit surface this round: the e2e spec docstrings. The prior R70-R76
rounds cleared the orchestrator / header-probe / fab-scale docstrings, and
R77 double-PASSed on those; the auditors have now swept into the e2e specs.

## Auditor B finding (CONFIRMED): `settleMorphFraction` misdescribed as a normalization

**F1:** `e2e/header-tab-descent-cross-tab-exit.spec.ts:24-25` said
`settleMorphFraction` is "normalized from `settleProgress`,
`settleStartProgress`, and `settleTargetProgress`". The implementation
returns `#settleEasedFraction` (the rAF's eased timeline fraction, tracked
independently). The orchestrator's field docstring (`:555-563`) explicitly
documents that independent tracking is load-bearing -- normalizing from
`settleProgress` would divide zero by zero for a saturated commit
(`settleStartProgress === settleTargetProgress === 1`), snapping the morph
in one frame. The e2e docstring described the very derivation the design
rejects. Rewrote the parenthetical to "the rAF's eased timeline fraction,
tracked independently of `settleProgress` so a saturated commit does not
divide zero by zero".

## Auditor A finding (CONFIRMED): `beforeNavigate` file attribution

**F1:** `e2e/tab-exit-preview.spec.ts:19` said
`beforeNavigate (NavPipelineHost.svelte) cancels the tab nav`. The
`beforeNavigate` hook is registered in `src/routes/+layout.svelte:86`
(calling `orchestrator.onSvelteKitBeforeNavigate`); `NavPipelineHost.svelte`
only mentions `beforeNavigate` in a comment (`:457`). The behavior
description is accurate; only the file attribution was wrong. Rewrote to
"(registered in `+layout.svelte`)".

## Orchestrator verification

Independently verified both. B-F1: confirmed `#settleMorphFraction()`
returns `#settleEasedFraction` (`:499-500`) and read the orchestrator's
field docstring (`:555-563`) documenting the independent tracking and the
0/0 hazard. A-F1: confirmed `beforeNavigate` is imported and registered in
`+layout.svelte` (`:7`, `:86`) and that `NavPipelineHost.svelte`'s only
`beforeNavigate` reference is the `:457` comment. Sibling sweeps:
"normalized from settleProgress" -> only the one e2e site;
"(NavPipelineHost.svelte)" / "(NavPipelineTabHost.svelte)" in e2e -> only
the one site. No missed siblings.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only (e2e spec docstrings); runtime unchanged.

## Disposition

Counter after R78: 0/5 (R77's 1/5 wiped). The audit surface has moved from
the orchestrator / header-probe docstrings (cleared R70-R76, R77
double-PASS) to the e2e spec docstrings.

# RV21-C01 Audit 133 (R133)

**Date:** 2026-08-05. **Round:** R133. **Votes:** auditor A BLOCK,
auditor B PASS. **Counter after: 0/5.**

## Outcome

A found 2 (F1: 5 route-list sites; F2: 1 method-docstring site). B PASSed
and explicitly rejected F1. Orchestrator verified F2 a genuine inaccuracy
(fixed) and F1 a defensible simplification (rejected, B-concurred). R133
is BLOCK (1 confirmed concern). Counter 0/5.

Trajectory: R130=12, R131=4, R132=1, R133=1 confirmed. The pool is small.

## F2 -- confirmed and fixed -- `orchestrator:4605` (`updateFromPathname`)

The docstring read "Non-tab-root pathnames (thread and compose detail
pages) keep their mount-time `fromTabIndex` (the centerTab value)." The
code (lines 4611-4616) preserves `fromTabIndex` for EVERY non-tab-root
pathname (newTabIdx = -1 -> keep mount-time value). For deep pages the
mount-time `fromTabIndex` is -1, NOT "the centerTab value" (deep pages
have no centerTab). The parenthetical "(thread and compose detail pages)"
is appositive/exemplifying, not scope-limiting, so the natural reading
makes "(the centerTab value)" a claim about all non-tab-root pathnames --
wrong for deep pages. Fixed: "Non-tab-root pathnames keep their mount-time
`fromTabIndex` (the `centerTab` for thread/compose routes, -1 for deep
pages)."

## F1 -- rejected as defensible (5 sites, B-concurred)

A flagged 5 route-type lists ("thread, compose, deep-page routes" at
orchestrator:35-36, 271-272, 1571; fab-scale.ts:15-17;
FloatingActionButtonLayer.svelte:12-13) as omitting the offline LIST mirror
routes. B explicitly considered and rejected this: "the universal claim the
parenthetical modifies is technically correct for the omitted categories
... defensible simplifications / canonical-example usages, not
inaccuracies ... the R130 'thread -> thread/compose' broadening was
specific to compose being a major category, not a general 'every category
must be enumerated' rule." Orchestrator concurs: the universals ("Every
mobile route mounts NavPipelineHost or NavPipelineTabHost") hold for
offline LIST (they mount NavPipelineHost); the parentheticals are
illustrative; offline LIST routes are mirrors of named categories exercising
the same host behavior. Rejected.

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
comment-only change.

## Disposition

Counter after R133: 0/5. The refined prompt (genuine-inaccuracy filter +
Class-2/F1 pre-emption via "tab-to-tab includes offline LIST" and
"illustrative parenthetical, not every-category-must-be-enumerated") keeps
the false-positive rate down; only genuinely-inaccurate value/claim
comments (F2) now surface. R134 tests whether the layer is clean.

**No git mutation.** No commits, no branches, no pushes.

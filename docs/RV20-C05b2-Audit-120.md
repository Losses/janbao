# DV20 Cycle 5b2 - Audit 120 (R120)

**Date:** 2026-07-22. **Round:** R120, the eighteenth spec-scoped round, the
first clean round after the R119 header-mode fix. **Counter after this round:**
2/5 (both auditors PASS; two votes). **Gate:** green (no code changes in R120;
the R119 green state stands).

Both spec-scoped auditors voted PASS: zero in-scope concerns. The R119 comment
fix (header-mode.ts:25-27 morph-source) held. Both auditors read every docstring
in the navigation / animation files and found them accurate. Auditor B ran an
expanded sole-rAF / sole-source-morph sibling grep (`single rAF` / `sole rAF` /
`one rAF` / `only writer` / `sole authority` / `single source of truth` /
`exclusively publishes` plus settle / tap-scrub ownership patterns) and
classified every hit legitimate: the executor's "Owns the single rAF loop"
(nav-executor.svelte.ts:4) and "one writer owns the visual" claims are scoped to
the executor's own page-track loop (with the explicit "The FAB and Header are
NOT written by this loop" qualifier from R117); executor-logic.ts:334 "all three
rAF channels share one curve definition" matches the current architecture.

## A nitpicks (non-BLOCKing, recorded; not fixed)

Auditor A recorded three observations it explicitly judged below the BLOCK bar
(strictly true, imprecise but not inaccurate). They are tracked here for
transparency; they are not fixed this round (both auditors PASSed, and the
orchestrator does not second-guess a PASS by pre-emptively rewriting comments
the auditors judged acceptable, since that would undermine audit independence
and could introduce new inaccuracies):

1. `nav-resolvers.ts:33-34, 111-115, 214-216, 251-253, 285-287, 302-303` (six
   sibling comments) say "the Header reacts through its own layer reading the
   pager store". The Header also reads the orchestrator singleton for settle /
   scrub, but the context of these comments is explaining why the `TransitionPlan`
   carries no Header fn (the Header is a reactive reader, not plan-driven), so
   the statement is strictly true and not misleading in context.
2. `mobile-pager.svelte.ts:23-26` frames the per-frame signals for the Header
   morph without enumerating MobileTabBar's (`fractionalIndex, active,
targetIndex`) or SearchTabBar's own reads. Imprecise framing, not wrong.
3. `header-mode.ts` retains "The tag-only derivation lands in a later cycle when
   the resolver takes over Header morph". Accurate description of the current
   state (`resolveHeaderMode` via `getCurrentTabIndex`) versus the target.

## Counter

2/5 (both auditors PASS = two votes). This is the first clean round after R119
(prior clean rounds: R101, R102, R104, R109, R111, R114, R118). Two more clean
rounds (four more PASS votes) close the cycle at 5/5. R121 audits the pipeline
under the spec scope.

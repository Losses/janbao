# DV20 Cycle 5b2 - Audit 132 (R132)

**Date:** 2026-07-24. **Round:** R132, the thirtieth spec-scoped round. **Counter
after:** 0/5 (auditor A PASS; auditor B BLOCK). **Gate:** green (16
e2e/production stale-comment fixes plus 1 flake root-cause; full e2e re-run, zero
flakies).

Auditor A voted PASS (examined production code, did not audit e2e comments).
Auditor B voted BLOCK on a 16-site stale-comment class: e2e spec files +
helpers.ts + 1 production (navigation-logic.ts:82), all describing REMOVED
animation mechanisms (Header CSS transitions, Header-owned rAFs
startSearchScrub / runSettleDriver, MobileTabPager concepts
snapIndex / shouldAnimateEnter / enterRaf), including two factual errors
(helpers.ts:727 claimed compose routes do not mount NavPipelineHost; they do.
enter-animation.spec.ts:13 claimed 0% to -50%; it is -33.333% for the 3-panel
track). A fixer sub-agent fixed the 16 sites and ran a comprehensive e2e sweep
(the third round of e2e-staleness findings after R128 / R129), confirming zero
removed-mechanism references remain (only legitimate LoadingChip-list-panel and
SsrFabFamily). The fixer also root-caused a flake it hit (fab-release-snap.spec.ts
assertSmoothRelease: a wall-clock 18ms descent guard miscalibrated after the FAB
curve steepened), replacing it with a deterministic intermediate-publications guard
(bar-preserving: a one-frame pop still fails).

## Findings fixed (16 comment sites + 1 flake root-cause)

### Stale-comment class (16 sites)

- Production: navigation-logic.ts:82 (shouldAnimateEnter became shouldEnter plus
  resolvedLeftHref).
- e2e: deep-to-deep-gesture-morph-spike.spec.ts:21-23, 156;
  search-back-hamburger-flash.spec.ts:192, 258; search-enter-exit-asymmetry.spec.ts
  :22-26, 252-255, 308-311; helpers.ts:216-223, 358-365, 727-734;
  reproduce-hamburger-settings.spec.ts:70-73; resize-desktop-to-mobile.spec.ts:7-19,
  31/49/75; enter-animation.spec.ts:13-19; fab-release-snap.spec.ts:10
  (sweep-found).

Each rewritten to the current mechanism (orchestrator-owned rAFs; no Header CSS
transitions; shouldEnter gate; -33.333% 3-panel track; compose routes mount
NavPipelineHost). The sweep confirmed zero removed-mechanism references remain.

### Flake root-cause (fab-release-snap.spec.ts:122-194)

The fixer's full-e2e run hit a flake in assertSmoothRelease. Root cause: the
wall-clock DESCENT_MS_FLOOR=18ms guard (R93) was miscalibrated after the FAB scale
curve steepened (descents now ~15ms on a correct ease; rAF timestamps compress
publications under load). Fixed with a deterministic intermediate-publications
guard (MIN_INTERMEDIATES=1): a one-frame pop (0.39 to 0.00) publishes zero
intermediates and fails; a correct ease publishes at least one and passes. The LEAP
guard (>=0.2 single-frame drop) is unchanged. Bar-preserving and
wall-clock-independent. Verified: fab-release-snap --repeat-each=10 gave 30/30; full
e2e 210/0 flaky.

## Note on coverage

A PASSed examining production code but did not audit the e2e comments (the third
round where a production-focused auditor missed e2e staleness a deeper-auditing one
caught). B's comprehensive e2e sweep surfaced the systematic staleness. The fixer's
exhaustive sweep (zero removed-mechanism refs remain) should close this for future
rounds.

## Gate

check 0 errors / 0 warnings (1467 files); lint exit 0 (similarity informational;
type duplicates 0); prettier clean; no U+2014; FULL e2e 210 passed / 0 flaky (9.4m,
exit 0; independently re-verified by the orchestrator); fab-release-snap
--repeat-each=10 30/30. Counter 0/5 (B's concern resets). R133 audits the cleaned
pipeline under the spec scope.

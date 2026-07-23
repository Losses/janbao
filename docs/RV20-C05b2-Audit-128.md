# DV20 Cycle 5b2 - Audit 128 (R128)

**Date:** 2026-07-23. **Round:** R128, the twenty-sixth spec-scoped round, the
first under the stripped (no-cycle-history, no-pre-explained-mechanism) prompt.
**Counter after:** 0/5 (auditor A BLOCK; auditor B PASS). **Gate:** green
(comment-only fixes; R122's full e2e remains valid).

Auditor A voted BLOCK; auditor B voted PASS. A found two stale comments in e2e
spec files describing the DELETED FAB family-swap mechanism. B PASSed examining
the production code and did not audit the e2e spec files.

## Scope adjudication

A explicitly deferred the scope call to the orchestrator: the audit prompt's
literal extension list was ".ts / .svelte.ts / .test.ts" (not ".spec.ts"). The
orchestrator adjudicates e2e `.spec.ts` comments as IN SCOPE: (a) R87 precedent
fixed stale pendingNav docstrings in e2e specs; (b) the owner's "fix architecture
cleanliness at all costs" directive covers test comments that document a deleted
mechanism; (c) the comment-accuracy rule's spirit. The audit prompt's extension
list is updated to explicitly include ".spec.ts" (including the e2e specs) to
remove the ambiguity for future rounds.

## A findings (2, fixed)

- **e2e/fab.spec.ts:131 (very low).** The comment claimed compose routes rest at
  scale 0 via "the layer's `cfg.family !== 'list'` branch". There is no
  `cfg.family` field (`FabConfig` has `kind: FabListKind`); the test-data
  `family` is an assertion field, not a production branch. The actual mechanism:
  the layer's scale derivation returns `getRouteData(pathname).fab ? 1 : 0`, and
  compose routes have `RouteData.fab === false`. Fixed to describe the actual
  mechanism.
- **e2e/messages-back-swipe.spec.ts:588-589 (very low).** The comment claimed the
  FAB scales 1->0 across a forward-enter via "the layer's family-swap ease, which
  holds at the destination scale (0) until the transition lands". The layer owns
  no ease; the scale is the reactive `fabScale(progress, fromHasFab, toHasFab)`
  half-mapping (`max(0, 1 - progress*2)` for from-only, reaching 0 at progress
  0.5 and holding at 0 through landing). Fixed to describe the actual mechanism.

A's broad grep (`familySwap`, `cfg.family`, `family-swap`, deleted-symbol sweep)
found exactly these two; production code is clean (the `fabScale` migration is
complete end-to-end).

## Note on B's coverage gap

B PASSed examining the production navigation/animation files but did not audit
the e2e `.spec.ts` files, so B missed A's two findings. This is a coverage gap
(B's sample did not include e2e specs), not a disagreement on the merits. The
audit prompt's clarified scope (".spec.ts" including the e2e specs) should close
this gap for future rounds. The two-auditor model surfaced the defect via A
regardless.

## Gate

check 0 errors / 0 warnings (1467 files); lint exit 0 (similarity informational;
type duplicates 0); prettier clean; no U+2014. Comment-only fixes (e2e spec
comments plus the audit-prompt doc); R122's full e2e (210 passed / 0 flaky)
remains valid. Counter 0/5 (A's concern resets). R129 audits the fixed pipeline
(including e2e specs) under the spec scope.

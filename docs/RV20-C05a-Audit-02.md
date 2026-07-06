# RV20-C05a - Audit Round 02 (2-auditor model)

Second audit round for Cycle 5a. Two auditors (A, B) examined the
post-R1 state. Result: **split** - auditor A PASS, auditor B
PASS-WITH-CONCERNS with one code-comment concern (the same forward-
looking-present-tense class as R1). Fixed; plus a proactive sweep fixed
a second instance of the same pattern. The implementation invariants
were again verified clean by both.

## Auditor verdicts

- **Auditor A: PASS.** Zero concerns. Deep verification: all 16
  (event x phase) lifecycle pairs total; the refcount deferral's
  same-tick cancel (closure reads `this.#state` at fire time); SSR
  `planUnmount` gates on `isBrowser` with no `onDestroy`; the real
  driver's sign convention matches `buildVisual`; shadow mode; every
  forward-looking docstring qualified (including confirming the R1
  `planUnmount` fix holds).
- **Auditor B: PASS-WITH-CONCERNS.** One concern: the `#isBrowser`
  field docstring said "this field is exercised only by the integrated
  pipeline" - but in Cycle 5a the controller is never constructed (no
  Svelte importer; the unit suite cannot load `$state` under `bun:test`),
  so the field is exercised by nothing. The sibling `#teardowns` and
  `phase` comments carried Cycle-5a qualifiers but `#isBrowser` did not.

## Concern (blocking, fixed)

- **`#isBrowser` field docstring** (auditor B;
  `page-lifecycle.svelte.ts:57`). Fixed: now states "In Cycle 5a shadow
  mode no caller constructs the controller, so this field is exercised
  by nothing; the integrated pipeline (Cycle 5b) will exercise it."

## Proactive fix (same pattern, found in the post-R2 sweep)

Per [[fix-thoroughly-not-band-aid-patches]], after the R2 concern I
swept all five new files for the same forward-looking-present-tense-
without-Cycle-5a-qualifier pattern (the one that recurred across R1/R2
and across Cycles 3-4). Found one more: the `PageLifecycleController`
class docstring said it "exposes the current phase reactively for
consumers to read in a `$derived`" - the `phase` getter below it was
qualified but the class-level docstring was not. Fixed: now states
consumers read it in the integrated pipeline, and in Cycle 5a shadow
mode the controller is not constructed so no consumer reads it. The
other present-tense hits in the sweep are accurate (the `settleRefcount-
Removal` "the caller applies the effect" describes the pure helper's
contract with its existing caller `HtmlSingletonClassController`; the
`defaultMatchMedia` "exercised by the unit suite" is a true statement
about the bun-runtime test).

## What was verified clean

Both auditors verified: lifecycle totality (all 16 event x phase pairs;
idempotency; out-of-sequence no-ops); refcount-with-microtask-deferral
(first-ref add; last-ref microtask-deferred remove; same-tick
remove+add does not flicker; closure reads state at fire time); SSR
single teardown path (`planUnmount` gates on `isBrowser`; no `onDestroy`;
no `import.meta.hot.dispose`); real driver write mapping (sign matches
`buildVisual`; FAB/Header compose correctly; null-element skip;
per-write resolver; `REDUCED_MOTION_QUERY` exact; SSR `matchMedia`
fallback); shadow mode (zero external importers; empty `git diff`);
all pasted journal numbers (70/144, 174/420, 1453 files, 55 pairs,
48/22 per-file).

## State after R2 fixes

70/70 unit tests pass across the two new suites (144 expect() calls);
`bun run check` 0 errors / 0 warnings; `bun run lint` exit 0; shadow
mode preserved; no em-dashes.

Consecutive pass votes: **0** (R2 split; B's docstring concern reset the
counter; A's PASS does not count toward convergence while B found a
concern).

# RV20-C05a - Audit Round 01 (2-auditor model)

First audit round for Cycle 5a. Two auditors (A, B) examined the CMA5a
output. Result: **split** - auditor A PASS, auditor B FAIL with one
code-comment concern. Both confirmed the implementation invariants hold.
The concern and the journal nitpicks are fixed.

## Prompt sent (clean, non-leading)

Context: Cycle 5a built two NEW shadow-mode modules (the lifecycle
pure-half + reactive shell, and the real `NavDomDriver`); no existing
gesture component / lifecycle-adjacent store / executor / driver-
interface modified. Open instruction to find any defect, verify
lifecycle totality, the refcount microtask-deferral (no same-tick
flicker), the SSR single-teardown-path (no `onDestroy`), the real
driver write mapping, shadow mode. v2 no-borderline classification
included (forward-looking 5b/5c claims in the present tense are
concerns). No prior-round framing.

## Auditor verdicts

- **Auditor A: PASS.** Zero concerns. Deep verification: all 16
  (event x phase) lifecycle pairs total; the refcount deferral's
  same-tick cancel (the closure reads `this.#state` at fire time, not at
  schedule time - that is what enables a same-tick acquire to cancel a
  pending removal); SSR `planUnmount` returns `runTeardowns: isBrowser`
  with no `onDestroy` import; the real driver's sign convention matches
  `buildVisual`; shadow mode (empty `git diff`, no external importers);
  every docstring accurate. Three nitpicks (per-file test counts 47/23;
  git-status paste omitted the spec file).
- **Auditor B: FAIL.** One concern: the `planUnmount` docstring said
  "even when the surrounding lifecycle hook runs in SSR" - but in Cycle
  5a there is no surrounding lifecycle hook (only the controller's
  `unmount` method and the unit suite); the `onDestroy` lifecycle hook
  is Cycle-5b wiring, stated in the present tense without a Cycle-5a
  qualifier. Two nitpicks: the same 47/23 per-file counts; a §13.5
  reference that is really §13 principle 5 (defensible, not flagged as a
  concern).

## Concern (blocking, fixed)

- **`planUnmount` docstring** (auditor B; `page-lifecycle-logic.ts:332`).
  Fixed: now states the current Cycle-5a callers (the controller's
  `unmount` method and the unit suite), the `isBrowser` gate mechanism,
  and the Cycle-5b wiring (the controller's `unmount` wired into a
  Svelte lifecycle hook) as an explicitly qualified forward-looking
  claim. Removed the unqualified "surrounding lifecycle hook" phrasing.

## Nitpicks (non-blocking, fixed)

- The journal's per-file test counts (47/23) were wrong; actual is
  48/22 (the total 70 matched because the errors cancelled). Corrected.
- The journal's pasted `git status --short` omitted
  `docs/DV20-Meeting/DV20-C05a-spec.md` (also untracked). Corrected.
- (Not fixed, defensible) the §13.5 reference is really §13 principle 5;
  auditor B did not classify it as a concern. Left as-is.

## What was verified clean

Both auditors verified: lifecycle totality (all 16 event x phase pairs;
idempotency; out-of-sequence no-ops); refcount-with-microtask-deferral
(first-ref add; last-ref microtask-deferred remove; same-tick
remove+add does not flicker; the closure reads state at fire time);
SSR single teardown path (`planUnmount` gates on `isBrowser`; no
`onDestroy` for html-singleton removal; no `import.meta.hot.dispose`);
real driver write mapping (pageTrack `translateX(${n}px)` preserves sign
matching `buildVisual`; FAB/Header compose correctly; null-element skip;
per-write resolver; `REDUCED_MOTION_QUERY` exact; SSR `matchMedia`
fallback); shadow mode (zero external importers; empty `git diff`);
all pasted journal numbers (70/144, 174/420, 1453 files, 55 pairs).

## State after R1 fixes

70/70 unit tests pass across the two new suites (144 expect() calls);
`bun run check` 0 errors / 0 warnings; `bun run lint` exit 0; shadow
mode preserved; no em-dashes.

Consecutive pass votes: **0** (R1 split; B's docstring concern reset the
counter).

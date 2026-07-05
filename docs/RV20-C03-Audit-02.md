# RV20-C03 - Audit Round 02 (2-auditor model)

> **Reconstructed post-hoc on 2026-07-05.** The prior orchestrator ran
> this round but wrote no audit file at the time. Concerns and fixes
> below are taken from the orchestrator's session transcript and
> verified against the current code state.

Two auditors (A, B) examined the post-R1-fix state. Result: **0/2 PASS**
(both FAIL). Four code-level concerns; all are correctness, stale-comment,
or missing-coverage defects.

## Concerns

1. **C1 - `'intent'` left in the type but unreachable.** R1's C3 fix
   changed every event production to kind `'resolving'` but did not
   remove `'intent'` from the `MacroPhaseKind` union, leaving a declared
   phase no event produces. R2's first pass removed `'intent'` from the
   union; R3 later restored it (the spec mandates `'intent'`; see
   Audit-03).
2. **C2 - missing test:** `pointercancel` while the classifier is in the
   `deciding` micro-phase. Added
   `pointercancel while deciding transitions to cancelled` in
   `nav-intent.test.ts`.
3. **C3 - coordinator's `hasAnySnippet` too coarse.** The field was
   described as "any entry with a snippet" but the deep-preview path
   only makes sense when the TO route specifically has a snippet, not
   any entry. Renamed `hasAnySnippet -> hasToSnippet`, narrowed the
   docstring to "a snippet for the TO route specifically", and the gate
   became `input.toSnapshotCapture && input.hasToSnippet`
   (`src/lib/utils/nav-coordinator.ts:48,93`; test fixture updated).
4. **C4 - stale/misleading docstrings.** The SSR docstring on
   `NavStateMachineOptions` claimed the wrapper does something "0 during
   SSR" that was not true (no events arrive during SSR so the reducer is
   never called). Corrected to state the actual contract. A separate
   `land`-case comment that referenced the superseded unconditional
   reset was also rewritten.

## State after R2 fixes

90/90 unit tests pass; `bun run check` 0 errors; `bun run lint` clean.

Consecutive pass votes: 0.

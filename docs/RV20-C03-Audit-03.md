# RV20-C03 - Audit Round 03 (2-auditor model)

> **Reconstructed post-hoc on 2026-07-05.** The prior orchestrator ran
> this round but wrote no audit file at the time. Concern and fix below
> are taken from the orchestrator's session transcript and verified
> against the current code state.

Two auditors (A, B) examined the post-R2-fix state. Auditor B returned
PASS-WITH-CONCERNS with one blocking concern; auditor A's verdict was
not recorded before the session's context-window limit interrupted the
round. The one concern is code/spec-level (a blocking concern under the
v2 classification), so the convergence counter resets regardless.

## Concern

- **The `'intent'` macro phase was removed from `MacroPhaseKind`.** R2's
  C1 fix deleted `'intent'` from the union to resolve the "unreachable
  phase" defect, but `docs/DV20-Plan.md` §6 and the C03 spec mandate
  `'intent'` as the phase the `intent` event produces (classified, plan
  not locked). Removing it trades one defect (unreachable phase) for
  another (spec violation). The clean resolution: keep `'intent'` as the
  produced phase and reserve `'resolving'` in the union for Cycle 5's
  async resolution path, with a comment marking it reserved.

## Fix applied between R3 and R4

1. Restored `'intent'` in `MacroPhaseKind`
   (`src/lib/stores/nav-state-machine-logic.ts:44`) with a comment
   documenting `'resolving'` as Cycle-5-reserved.
2. Reverted every event production from `kind: 'resolving'` back to
   `kind: 'intent'` (the `intent` case, the landing-re-entry branch, and
   the `interrupt` case, lines 199/213/289).
3. Reverted the `resolved`-case guard from
   `kind !== 'resolving' && kind !== 'transitioning'` back to
   `kind !== 'intent' && kind !== 'transitioning'` (line 228).

## State after R3 fixes

90/90 unit tests pass at the time; `bun run check` 0 errors; `bun run
lint` clean.

> **Note added during R4 reconstruction (2026-07-05):** the R3 fix also
> introduced an unrelated regression: an over-broad guard on the
> `reset` case (`kind !== 'landing' && kind !== 'at-rest'`) that made
> `reset` a no-op from `transitioning`, breaking the committed test
> `reset returns to at-rest and clears from/to`. This was caught and
> fixed during the R4 reconstruction pass (see Audit-04): the guard is
> narrowed to `kind === 'intent'` (the only phase reset must protect,
> the landing-microtask race), and a preventive test
> `reset from intent is a no-op` was added.

Consecutive pass votes: 0.

# RV20-C03 - Audit Round 01 (2-auditor model)

> **Reconstructed post-hoc on 2026-07-05.** The prior orchestrator ran
> this round but wrote no audit file at the time (the session hit its
> context-window limit mid-R4). The concerns and fixes below are taken
> from the orchestrator's session transcript and verified against the
> current code state. They are not the verbatim auditor outputs.

Two auditors (A, B) examined the initial Cycle 3 implementation against
`docs/DV20-Meeting/DV20-C03-spec.md` and `docs/DV20-Plan.md` §2/§4/§6.
Result: **0/2 PASS** (both FAIL). Auditor B surfaced eight code-level
concerns; auditor A converged on the same core three plus secondary
ones. All eight were code correctness or stale-comment defects (none
were journal-text nitpicks).

## Concerns (auditor B's eight, A-convergent)

1. **C1 - titleCrossfade reversal (render bug).** `tabDetailResolver`'s
   backward direction returned `titleCrossfade: morph` where
   `morph = 1 - progress`. At `progress = 1` (TO visible) this yielded
   `0` (the old title still showing). The other resolvers used
   `clamp(progress, 0, 1)` directly. Fixed: `titleCrossfade` now follows
   `clamp(progress, 0, 1)` in every resolver
   (`src/lib/utils/nav-resolvers.ts:263,317,364`).
2. **C2 - `via` hardcoded.** `ResolvedTarget.via` was typed as
   `'tap' | 'popstate' | 'hashchange' | 'goto'` but `intentTarget`
   always returned `'goto'`, discarding the input-source distinction.
   Fixed: the type is narrowed to `'goto'` for all Cycle-3 shadow-mode
   navigations, with a comment that Cycle 5 discriminates the real
   SvelteKit event sources when it wires them
   (`src/lib/utils/nav-intent.ts:156-161,324`). The dead
   `if (intent.micro === 'committed') via = 'goto'` branch was deleted.
3. **C3 - `resolving` phase unreachable.** The `MacroPhaseKind` union
   declared `'resolving'` but the reducer jumped `'intent' -> 'transitioning'`
   directly; `'resolving'` was never produced. (Architecture-vs-code
   mismatch.) The R1 fix changed every `'intent'` production to
   `'resolving'`; R3 later reverted this (see Audit-03) because the spec
   mandates `'intent'` and reserves `'resolving'` for Cycle 5 async
   resolution.
4. **C4 - empty if-block** in `intentTarget` (the dead `committed`
   branch above). Removed with C2.
5. **C5 - missing test:** `land` from `at-rest` (the first-load path).
   Added `land from at-rest enters landing (first-load path)` in
   `nav-state-machine-logic.test.ts`.
6. **C6 - missing test:** `resolved` arriving while `committing`
   preserves the `committing` sub. Added
   `resolved from transitioning/committing preserves committing sub`.
7. **C7 - `onLand` microtask untested.** The reactive wrapper schedules
   the landing -> at-rest transition via a microtask, which cannot be
   exercised under `bun:test` (no runes loader; see
   `[[bun-test-no-runes-loader]]`). Recorded as a nitpick, not fixed at
   the unit level.
8. **C8 - dead code.** `lerp` in `nav-resolvers.ts` was unused after the
   clamp rewrite. Removed the function and its `__test` reference.

## State after R1 fixes

89/89 unit tests pass across the four pure-half suites (the 87 the round
examined + the 2 preventive tests added by C5/C6); `bun run check` 0
errors; `bun run lint` clean. Shadow mode preserved (no existing gesture
component modified).

Consecutive pass votes: 0.

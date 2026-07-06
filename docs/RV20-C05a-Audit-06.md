# RV20-C05a - Audit Round 06 (2-auditor model)

Sixth audit round for Cycle 5a - the first round run with the clean
protocol prompt (no `Verify X` checklist, no defect-pattern hints),
after the owner flagged that the R1-R5 prompts had drifted into
narrowing/leading. Two auditors (A, B). Result: **split** - auditor A
FAIL with one concern that the directive prompts had downplayed,
auditor B PASS. Fixed.

## Prompt sent (clean, non-leading)

The clean protocol template: context (what the system IS) + "find ANY
defect empirically" + the binding classification (concern vs nitpick,
no specific patterns) + verdict. No `Verify X` list, no comment-accuracy
defect-pattern hints. No prior-round framing.

## Auditor verdicts

- **Auditor A: FAIL.** One concern: three `.ts` code comments (the
  module docstrings of `page-lifecycle-logic.ts` and
  `page-lifecycle.svelte.ts`, and the `registerTeardown` docstring)
  listed `page-scroll` as a lifecycle-adjacent store for Cycle 5b to
  migrate, but `page-scroll.svelte.ts` was deleted in Cycle 2 (unified
  into `PageCacheStore`). Inaccurate code comment in `.ts` -> CONCERN
  (not a nitpick; nitpick is `.md` only). R5-B had flagged this same
  issue as a non-blocking "Plan-level observation"; A, applying the
  binding rubric strictly, correctly reclassified it as blocking.
- **Auditor B: PASS.** Zero concerns. Verified all invariants, all
  R1-R4 fix sites hold, every docstring Cycle-5a-accurate or qualified.

## What the clean prompt surfaced

The directive prompts (R1-R5) accumulated a comment-accuracy defect
checklist that focused auditors on forward-looking-claim hunting. The
`page-scroll` inaccuracy is a different class (a wrong claim about what
stores exist), and the directive prompts downplayed it (R5-B called it
non-blocking). The clean-prompt R6-A caught it and classified it
correctly. This validates the owner's concern that the directive prompts
were narrowing the review.

## Concern (blocking, fixed)

- **`page-scroll` referenced as an existing store in three `.ts`
  comments** (auditor A; `page-lifecycle-logic.ts:24`,
  `page-lifecycle.svelte.ts:26` and `:121`). Fixed: dropped `page-scroll`
  from all three parentheticals (the migrate list is now the three
  existing stores: `viewport-lock`, `scroll-chrome`,
  `active-gesture-track`). No historical note (per the no-history-comments
  rule) - scroll-state capture lives in `PageCacheStore`, not in an
  html-singleton store, so it is correctly absent from the migrate list.

## Nitpicks (non-blocking, `.md` only)

- The C05a spec and journal repeat the same `page-scroll` list (root
  cause: Plan §8, which also lists `page-scroll`, is itself stale -
  `page-scroll` was deleted in Cycle 2). To be fixed in the journal/spec
  for consistency; Plan §8 is the architect's doc and is flagged for
  them to update.

## State after R6 fixes

70/70 unit tests pass across the two new suites (144 expect() calls);
`bun run check` 0 errors / 0 warnings; `bun run lint` exit 0; shadow
mode preserved; no em-dashes; no `page-scroll` in any `.ts` file.

Consecutive pass votes: **0** (R6 split; A's `page-scroll` concern reset
the R5 streak of 2. The implementation logic has been auditor-verified
clean across R1-R6; the clean prompt is now in use going forward).

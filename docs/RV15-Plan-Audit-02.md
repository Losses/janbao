# RV15-Plan-Audit-02 - Plan audit round 02

Five fresh independent open-ended auditors (no roles, no steering, read-only, no
e2e, no git mutation) reviewed the cleaned `docs/DV15-Plan.md` (revision history
moved to `docs/DV15-Meeting/DV15-Plan-Journal.md`; round-1 findings were not
disclosed to this round, so the auditors independently re-derived).

## Tally

| Auditor | Verdict |
| ------- | ------- |
| R2-1    | PASS    |
| R2-2    | PASS    |
| R2-3    | PASS    |
| R2-4    | PASS    |
| R2-5    | PASS    |

**5/5 PASS → round 2 PASS. Plan approved for implementation.**

All five independently confirmed the root cause and that the latch eliminates the
spike on every deep→deep commit shape, preserves the deep→tab descent, and leaves
the cancel / click / search / SSR / re-arm / null-`backTarget` / `releaseConsumed`
paths inert. No blocking issues.

## Notable concerns (non-blocking, carried to implementation)

- **N1 - the `settling ?` ternary's stated rationale is loose (R2-1, R2-2, R2-3, R2-5).**
  §4.1 justifies `(settling ? latchedTargetTabs : targetHasTabs)` by a
  "pre-Effect-B release window where `isSettleMode` is true via
  `lastGestureMorph > ε`". That window does not open in observable renders:
  Effect B is `$effect.pre` (`Header.svelte:237`), so on the release flush it
  writes `settling = true` and `latchedTargetTabs` before the `morph` `$derived`
  is read for the DOM update. The gate is harmless and defensive; the rationale
  is documentary only. No code change.
- **N2 - the gesture deep→tab arm already has partial coverage (R2-4).**
  `e2e/header-tabs-replay.spec.ts:118` already drives a real CDP `swipeBackHalf`
  from `/profile/settings` (deep) to `/messages/inbox` (tab) - a genuine gesture
  deep→tab commit on the same arm the fix touches (its invariant is "no
  snap-and-replay", adjacent but not identical to the latch). The plan's PRESERVE
  test is therefore additive focus, not the sole coverage the round-1 framing
  implied. Implementation may add PRESERVE as a targeted `latchedTargetTabs`
  witness or rely on `header-tabs-replay` + a minimal latch assertion.
- **N3 - `latchedTargetTabs` not surfaced in `__headerMorphProbe` (R2-3, R2-5).**
  The probe (`Header.svelte:561-585`, `header-probe.ts`) captures
  `targetHasTabs` but not the new latch. A future divergence would be invisible
  in the trace. Recommend adding `latchedTargetTabs` to `HeaderStateSnapshot` as
  a low-cost documentary field during implementation.
- **N4 - other 2-level deep→deep spike shapes are unnamed (R2-4, R2-2).**
  `/profile/[id]/[slug] → /profile`, `/profile/appearance|edit|... → /profile/settings`,
  `/profile/invitations → /profile` all share the spike shape (destination-back
  flips to a tab) and are all fixed by the same latch. GENERALIZATION's
  `/admin/categories → /admin` is a sufficient witness, not an exhaustive
  enumeration.
- **N5 - §6 deep→deep→deep example is stack-depth ambiguous (R2-2).** The
  no-spike example only holds for the 4-entry stack where the destination's back
  is itself deep; a 3-entry reading would spike. The logic ("the spike requires
  the destination's back to flip to a tab") is correct; the example notation
  invites the wrong reading. Documentation only.
- **N6 - `endSettle()` could defensively clear the latch (R2-3, R2-5).** Cosmetic;
  the latch is only read while `settling = true`, so freshness is already
  guaranteed by the next release rewriting it.

## Verified-clean (consensus, all five)

- Root cause confirmed: `targetHasTabs` (`Header.svelte:67-69`) flips false→true
  at the `beforeNavigate` popstate pop (`navigation-logic.ts:152-154`) while
  `currentPath` lags (updates at/after `afterNavigate`), so the commit arm
  (`Header.svelte:171-174`) returns `0·0 + 1·1 = 1`.
- The latch (written in Effect B's `untrack` block after the `!navStore.backTarget`
  guard, before the `if (committed)` split; read via
  `(settling ? latchedTargetTabs : targetHasTabs)` at `:158`) holds morph at 0
  through every deep→deep commit flush from release through `endSettle`.
- Deep→tab descent preserved: at release `backTarget` is the tab root →
  `latchedTargetTabs = true` → morph ramps to 1.
- Cancel / click (Effect C idle → regular arm) / re-arm (Effect C → regular arm) /
  search (`isSearch` false on deep routes) / SSR (`$effect.pre` client-only,
  `$state(false)` default) / `releaseConsumed` same-flush re-run (`:239` early
  return) / null-`backTarget` (dead code; `backTargetFor` never empty) all inert.
- Consumer cascade (§4.5) holds term-by-term at morph = 0; no consumer expression
  needs editing. `getCurrentTabIndex` already imported (`:35`).
- `header-tab-descent-cross-tab-exit.spec.ts` is click-only (confirmed); the
  gesture deep→tab arm is exercised by `header-tabs-replay.spec.ts` (N2) and will
  be hardened by PRESERVE.
- All line citations accurate (±2 lines) across ~25 references.
- Scope honesty: the deferred unified-transition-record refactor is preventive;
  the minimal latch closes this defect completely (no residual divergence on the
  commit target can re-open this specific bug class).

## Revision decisions

None blocking. N3 (add `latchedTargetTabs` to the probe) and N2 (decide PRESERVE
shape) are adopted during implementation. N1/N5 are doc imprecisions that do not
affect correctness and need no plan re-revision. Plan is FINAL at 5/5.

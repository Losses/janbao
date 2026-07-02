# RV15-Plan-Audit-06 - Plan audit round 06 (structural plan, 3rd revision)

Five fresh independent open-ended auditors (no roles, no steering, read-only, no
e2e, no git mutation) reviewed the 3rd-revised structural `docs/DV15-Plan.md`
(round-5 B1 `isSettleMode` in probe + N1 m-continuity bridge retained + N2-N7
cleanups adopted). Round-5 findings not disclosed.

## Tally

| Auditor | Verdict |
| ------- | ------- |
| R6-1    | PASS    |
| R6-2    | PASS    |
| R6-3    | PASS    |
| R6-4    | PASS    |
| R6-5    | PASS    |

**5/5 PASS → round 6 PASS. Plan FINAL and approved for implementation.**

All five independently confirmed the design. No blocking issues.

## Notable concerns (non-blocking, carried to implementation)

- **N1 - the m-continuity bridge's `lastGestureMorph` arm is dead under the
  invariant (R6-2, R6-4, R6-5).** Inside `if (latchedSettle)`, `settling` is
  always true (the arming invariant), so `progress = settling ? settleProgress :
  lastGestureMorph` always takes `settleProgress`. The actual m-continuity comes
  from `settleProgress = m` (`Header.svelte:285`) set in the same Effect B flush
  as the record. The bridge is retained harmlessly (formula-shape parity); during
  implementation, reframe its comment to "actual continuity from `settleProgress =
  m` in the same `$effect.pre` flush; `lastGestureMorph` arm is unreachable under
  the arming invariant but kept for parity". (The memory `svelte-effect-pre-same-flush-rerun`
  is about spurious re-runs, not skipped runs - Effect B fires in the dragging-flip
  flush, so the sub-flush release window does not render.)
- **N2 - Effect C re-arm assignment TS narrowing / null-deref (R6-1, R6-2).** The
  re-arm guard uses `?.` but the assignment reads `latchedSettle.incomingTitle`
  bare; a future desync (settling=true, latchedSettle=null) would throw. Use the
  defensive `latchedSettle?.incomingTitle ?? newTitle` form (and re-predicate the
  guard to narrow) for symmetry with the titleView `?? ''` style.
- **N3 - Effect C idle record is set only in the `newTitle && newTitle !== restTitle`
  sub-branch (R6-4).** The idle branch (`:327-342`) has three sub-branches; the
  record arms only where `settling = true` is also set. Note this in implementation.
- **N4 - bidirectional invariant left implicit (R6-2).** `settling=true ⇔
  latchedSettle !== null`. State it explicitly in the journal so a future
  maintainer doesn't add a third path that flips `settling=false` without clearing
  the record.
- **N5 - §7 preventive test scope (R6-1, R6-3, R6-5).** Honestly limited to
  centralized `tabsOut/tabsIn` resolution reverts; a NEW bypass consumer is not
  caught (inherent to source-attributing tests). A static ESLint complement would
  close it; optional.

## Verified-clean (consensus, all five)

- Framing honest (minimal latch in tree; DV15 = class closure + subsumption). All
  ~40 line cites accurate against the current tree.
- Three arming sites (Effect B, Effect C idle, Effect C re-arm) with correct
  4-field mappings + re-arm rotation; all 5 latch-read sites migrated
  (`:163`, `:302`, `:314`, `:471`, `:529-530`, `:584`).
- Morph arm collapse `outgoing*(1-p)+incoming*p` algebraically equivalent on all
  three sub-arms; m-continuity bridge retained; null-record fall-through explicit.
- `layerDownStyle` NOR `(!tabsOut && !tabsIn)` (not NAND); deep→tab descent
  preserved; `tabsOut`/`tabsIn` hoisted to top-level `$derived` shared by layer
  styles + probe.
- endSettle ordering (restTitle before null clear, same tick as `settling=false`).
- §7 preventive test: `isSettleMode` in probe (assertion (a) writable);
  `effectiveTabsOut/In` from hoisted locals (non-vacuous); claim scoped.
- Regressions (CLEAR placement, cancel, re-arm, `releaseConsumed`, `!backTarget`,
  `iconProgress`, `isDeepToDeep` preserved for drag arm, `isSearch`, SSR, search)
  all preserved. `titleView ?? ''`.
- `getCurrentTabIndex` imported (`:35`); `HeaderSettleTransition` satisfies
  interface-first / zero-inline-typing.

## Revision decisions

None blocking. N1 (bridge comment reframe), N2 (re-arm `?? newTitle`), N3 (idle
sub-branch scoping) are adopted during implementation. N4/N5 are doc/lint notes.
Plan is FINAL at 5/5. Proceed to structural implementation.

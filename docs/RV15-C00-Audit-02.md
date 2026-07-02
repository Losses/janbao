# RV15-C00-Audit-02 - Structural implementation audit

Five independent open-ended auditors (no roles, no steering, read-only, no e2e,
no git mutation) reviewed the DV15 structural C00 implementation (the actual
`git diff HEAD` on the three DV15 files: `Header.svelte`, `header-probe.ts`,
`e2e/deep-to-deep-gesture-morph-spike.spec.ts`) against the approved structural
plan `DV15-Plan.md` and journal `DV15-C00-Journal.md`. `+layout.svelte` and
`fab-compose-backswipe.spec.ts` (the owner's concurrent work) were explicitly out
of scope.

## Tally

| Auditor | Verdict |
| ------- | ------- |
| 1       | PASS    |
| 2       | PASS    |
| 3       | PASS    |
| 4       | PASS    |
| 5       | PASS    |

**5/5 PASS → structural C00 round 1 PASS. Implementation accepted.**

All five independently confirmed the diff faithfully implements the structural
plan, the bidirectional invariant (`latchedSettle !== null ⇔ settling === true`)
holds at every write/clear site, all four settle trajectories trace correctly,
no settling render-path consumer reads a live endpoint identity, and the
PREVENTIVE test is non-vacuous (source-attributing). No blocking issues.

## Blocking issues

None.

## Notable concerns (non-blocking, adopted)

- **N1 - stale `latchedTargetTabs` reference in a newly-added comment
  (auditors 1, 2, 4, 5).** `e2e/deep-to-deep-gesture-morph-spike.spec.ts` PRESERVE
  comment said "the arm where `latchedTargetTabs` must be true" - the removed
  minimal-latch field. **Adopted:** rewritten to `latchedSettle.incomingHasTabs`
  to match the assertion it documents.
- **N2 - journal "no live currentHasTabs/targetHasTabs read during settle"
  over-precise (auditor 3).** `iconProgress` (`Header.svelte:194`) still reads
  live `currentHasTabs`, but it is search-scoped (`searchScrubbing && currentHasTabs`,
  and `searchScrubbing=false` on every settle path the record owns) so no
  divergence results. Plan §4.6 excludes it; the journal Verify wording is
  softened to "no live read on any settle path the record owns".
- **N3 - plan/journal "three latches / in-tree `latchedTargetTabs`" framing
  (auditors 2, 3, 5).** The net diff vs HEAD removes TWO latches
  (`latchedOutgoing`/`latchedIncoming`); `latchedTargetTabs` was the rejected
  minimal-latch C00, never in HEAD. The "three" is accurate as DV15 history (the
  minimal latch was implemented then superseded in the working tree) but
  misleading vs the net diff. Documentation narrative; the journal Phase map
  corrects the record. No change to the plan (it is the design narrative).
- **N4 - dead `lastGestureMorph` arm (all five).** Inside `if (isSettleMode &&
latchedSettle)`, `progress = settling ? settleProgress : lastGestureMorph`
  always takes `settleProgress` under the arming invariant. Knowingly retained
  for formula-shape parity / defensive cover (`svelte-effect-pre-same-flush-rerun`);
  cannot mask a real path (a stuck-record state would also corrupt `tabsOut/tabsIn`
  visibly). Harmless.
- **N5 - PREVENTIVE test scope (auditors 3, 4, 5).** Catches reverts of the
  shared `tabsOut/tabsIn` derivation to live; does NOT catch a NEW consumer that
  bypasses them and reads `targetHasTabs` directly. Inherent to source-attributing
  tests; plan §7 discloses it.

## Verified-clean (consensus, all five)

- Diff implements the plan verbatim: `latchedSettle` (`Header.svelte:95`) replaces
  the old latches; armed at Effect B (`:270`), Effect C idle (`:345`, the
  `newTitle && newTitle !== restTitle` sub-branch), Effect C re-arm (`:323`,
  rotation); morph settle arm is the single `outgoing*(1-p)+incoming*p` with a
  null fall-through (`:167-178`); `tabsOut`/`tabsIn` hoisted (`:571-572`) and
  consumed by both layer styles + the probe; `layerDownStyle` NOR `!tabsOut && !tabsIn`
  (`:583`); `endSettle` restTitle-before-clear (`:490-492`).
- Bidirectional invariant holds at every arming (B `:270`+`:286`, C idle
  `:345`+`:355`, re-arm `:323` while settling already true) and every clear (B
  CLEAR `:248`+`:250`, endSettle `:491`+`:492`).
- All four trajectories correct: deep→deep (morph 0), deep→tab (ramp to 1,
  descent preserved), cancel (retreat to outgoing), click (prev→current).
- No settling render-path consumer reads a live endpoint identity
  (`titleView:552-553`, morph `:167-175`, `rootLayerStyle:575-581`,
  `layerDownStyle:582-586` all source from the record / hoisted `tabsOut/tabsIn`).
  `iconProgress` stays live but search-scoped; `backTitle` feeds only the drag
  branch. `grep` confirms no remaining `latchedOutgoing`/`latchedIncoming`/
  `latchedTargetTabs` code references in `src/`.
- PREVENTIVE test non-vacuous: `effectiveTabsOut/In` alias the hoisted
  `tabsOut/tabsIn` (not a replayed formula); a live revert diverges on the
  deep→deep landing; the `isSettleMode → latchedSettle !== null` assertion
  guards the arming same-flush invariant; a vacuous-guard asserts a settle frame
  was captured.
- Regressions: re-arm TS narrowing + null safety (`:313-319`), latch-read
  migrations (absorb `:301`, re-arm guard `:317-318`, endSettle `:490`,
  titleView `:552-553`), `releaseConsumed` same-flush re-run, `!backTarget`
  guard, SSR (`$state(null)` + client-only `$effect.pre`), search path - all
  preserved. Auditor 4 independently ran `bun run check`: 0/0.
- `HeaderSettleTransition` defined once (`header-probe.ts:22-27`), imported by
  Header (`:49`); the e2e mirror redeclaration is the pre-existing Playwright
  pattern (outside `./src`, not similarity-ts-scanned). Interface-first satisfied.
- Journal claims consistent with the diff (test-result numbers UNVERIFIED per the
  read-only/no-e2e constraint, but structurally consistent; no overclaim beyond
  the N2/N3 wording).

## Deviation assessment

Acceptable. The implementation matches the plan; the round-6 non-blocking
notables (re-arm `const prev` narrowing, bridge comment, idle sub-branch scoping,
`titleView ?? ''`) are all in place. The single doc cleanup (N1) is adopted; N2
softened. No code-behaviour change in the revision. **DV15-C00 structural
COMPLETE at 5/5.**

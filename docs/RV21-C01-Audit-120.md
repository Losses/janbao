# RV21-C01 Audit 120 (R120)

**Date:** 2026-08-04. **Round:** R120. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

A and B INDEPENDENTLY converged on the same two defects (strong
corroboration): the `startMorph` overclaim in the morph-derivation
list (Header.svelte:275) and the `HeaderSettleTransition.startMorph`
docstring (header-probe.ts:39). Both attribute "the drag's terminal" to
the gesture-interrupted-discrete-nav case, where the drag is cut short
and the captured value is the interrupt-instant value, not terminal --
the identical class R100-R119 fixed at 23 sites in the orchestrator.

Both auditors swept `src/lib` thoroughly (concept grep, every variant:
`drag's terminal` / `drag-terminal` / `gesture-terminal` / `drag
branch's terminal`). The R119 lesson (grep the concept, every spelling)
was applied; both found these two as the only src/lib residuals.

## Orchestrator cross-directory + spec sweep

The orchestrator re-ran the concept grep across the WHOLE layer
(`src/lib/stores`, `src/lib/components`, `src/lib/utils`, **and `e2e/`**).
Both auditors' greps were confined to `src/lib`; neither covered `e2e/`.
The class had **9 unfixed siblings** in `e2e/messages-back-swipe.spec.ts`,
all in the discrete-nav / takeover path (R14 F1, R22-A F1, R23-B tests):

- `:2007` -- "settleProgress equals the drag's terminal `pager.backMorph`"
  (discrete-nav arm; parallel to the orchestrator:3020 R119 fix).
- `:2831` -- "the drag-terminal FAB scale" (R14 F1 discrete-nav arm).
- `:2839` -- "captures the drag-terminal FAB value at the LIVE
  `#publication.progress`" ("at the LIVE progress" contradicts "terminal").
- `:2846` -- "the same drag-terminal state at the takeover instant".
- `:2882` -- "so the drag's terminal FAB is non-zero" (raw > 0.5 mid-drag).
- `:2902` -- "so the drag's terminal FAB is `max(0, (0.65-0.5)*2) = 0.3`"
  -- the comment's own math proves the overclaim: at raw=0.65 the FAB is
  0.3, but the drag's actual terminal (raw=1) is `max(0,(1-0.5)*2)=1.0`.
  0.3 is the interrupt-instant value.
- `:2962` -- "snaps from the drag's terminal (1 - raw)" (discrete-nav
  handoff; (1-raw) is the live interrupt value, terminal at raw=1 is 0).
- `:3041` -- "snaps from the drag's terminal (raw)" (same, deep source).
- `:3212` -- "continuous with the drag's terminal value" (captures live
  bm=0.30 at the discrete-nav interrupt).

All 9 rewritten to "interrupt-instant value" / "FAB value at the LIVE
progress" / "live `pager.backMorph` at the interrupt".

## Total fixed this round: 11 sites

Header.svelte:275 (splits the list: release -> terminal; discrete-nav
interrupt -> interrupt-instant value), header-probe.ts:39 (rewrites to
"the drag branch's value at the settle-arm instant"), and the 9 e2e
sites above.

## Verified properly-scoped (NOT defects)

Every remaining `terminal` hit in the layer is one of:

- **Gesture-release** (a live drag reaches terminal at release):
  Header.svelte:275 (now release-only), :539; fab-scale.ts:157;
  header-probe.ts:78, :240; orchestrator:735, 2783, 3290, 3452, 3522,
  3532, 3573, 4348, 4350; e2e:1503, 1505, 2719, 2722, 2803;
  offline-back-swipe:29, 35; reproduce-dv20-search-swipe:133.
- **Saturated raw=1 edge** (the drag genuinely at terminal):
  orchestrator:2858; e2e:1832, 1926.
- **Constant-0 isDeepToDeep** (terminal = instant for a constant morph):
  orchestrator:3596; e2e:3131, 3133, 3135.
- **Commit/settle destination terminal** (raw=1 at commit landing) and
  **FAB epsilon**: header-probe.ts:26, 141, 190, 245; orchestrator:551,
  589, 602, 761, 779, 849, 861, 1285, 1303, 1315, 2227, 2232, 2241,
  2245, 2353; e2e:1556, 2336, 2491, 2532, 2701, 2735, 2764, 3277;
  fab.spec.ts:1087, 1095.

## Root cause of the R100-R120 tail

Two compounding blind spots, each surviving multiple rounds:

1. **Lexical-form** (R100-R119): sweeps grepped `drag's terminal` and
   `gesture-terminal` but not the hyphenated `drag-terminal`. Fixed by
   R119's concept-grep discipline.
2. **File-boundary** (R120): even with concept grep, both auditors
   confined the sweep to `src/lib` and never covered `e2e/`. The class
   spans the whole navigation/animation layer; the sweep must too.

## Verify

`bun run check` 0/0; `prettier --check` clean on all 3 edited files; no
U+2014 em-dash; comment-only changes (runtime unchanged; e2e logic
untouched). The discrete-nav/takeover overclaim class is now genuinely
exhausted across `src/lib` AND `e2e/`.

## Disposition

Counter after R120: 0/5. Future rounds: the sibling sweep MUST cover
every directory the layer touches (`src/lib/stores`, `src/lib/components`,
`src/lib/utils`, `e2e/`), grep the concept across every spelling, and
read every hit. The class is exhausted only when a cross-directory grep
returns zero unverified hits.

**No git mutation.** No commits, no branches, no pushes.

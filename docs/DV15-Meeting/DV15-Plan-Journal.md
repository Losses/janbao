# DV15-Plan-Journal - planning meeting log

Author's working log for `docs/DV15-Plan.md`. The Plan file itself is the clean
final specification; this journal holds the round-by-round deliberation and
revision history. Plan-audit verdicts live in `docs/RV15-Plan-Audit-NN.md`.

## Round 1 - 2026-07-02

Five independent open-ended auditors (no roles, read-only, no e2e, no git
mutation) reviewed `DV15-Plan.md`. Tally: **4 PASS / 1 changes_requested → round
1 FAIL (not 5/5).** Full detail: `docs/RV15-Plan-Audit-01.md`.

All five independently confirmed the root cause (the popstate stack-pop flips
`backTarget` to a tab while `currentPath` lags, so `targetHasTabs` flips
false→true mid-settle and the morph commit arm returns `0·0 + 1·1 = 1`) and that
the latch eliminates the spike. The round did not pass because two issues were
flagged by every auditor (blocking by auditor 3, non-blocking by the other
four).

### B1 - the cited deep→tab guard is click-only

`header-tab-descent-cross-tab-exit.spec.ts` drives its back leg with a header
back-arrow **click**, not a CDP-touch gesture. The click path does not enter
Effect B and takes the morph settle **regular** arm (`prev`/`current`, never
`target`), so `latchedTargetTabs` is never read. The Plan's claim "deep→tab
commit preserved … Guarded by `header-tab-descent-cross-tab-exit.spec.ts`" was
therefore unverified for the gesture path the fix actually depends on.

**Revision:** added a PRESERVE test to `e2e/deep-to-deep-gesture-morph-spike.spec.ts`
- a `swipeBack` from `/profile/settings` (GPL-mounted deep route, back target
`/`) to `/`, asserting via `__headerMorphProbe` that `settling === true &&
morph >= 0.9` co-occur in the commit window and the tabs layer descends through
real intermediate `translateY` px. Specified in Plan §5 and §7.

### B2 - §4.1 / §6 contradicted on latch placement

§4.1 placed the latch "right after `const inc`" (`Header.svelte:261`), **before**
the `if (!navStore.backTarget)` guard (`:262-266`); §6 claimed that guard
"returns before the latch write". Both cannot hold.

**Revision:** §4.1 now places the latch **after** the guard, immediately before
`if (committed)` (between `:266` and `:267`). §6 notes `backTargetFor`
(`navigation-logic.ts:57-64`) always returns a non-empty string (seeded stacks),
so the guard is effectively dead code and the null-`backTarget` edge is
unreachable regardless; placement after the guard keeps §6's text consistent by
construction.

### Documentation corrections adopted (non-blocking, all five convergent)

- **§3.4 click-path mechanism.** The back-button path does NOT run "Effect B's
  clear branch → rest arm". Effect B does not re-run on a click (its tracked
  deps `dragging` / `navStore.pendingNav` do not change). The title change fires
  Effect C's idle branch, which sets `settling = true`, `settleAwaitTitle =
false`, so morph takes the settle **regular** arm (`:180`). On deep→deep
  `prev = current = 0`, so morph = 0 - conclusion unchanged, mechanism corrected.
- **Effect C re-arm wording (§6).** The re-arm is safe because it sets
  `settleAwaitTitle = false` + `settleTarget = 1`, forcing the settle arm out of
  the `awaitTitle`/`targetZero` branches into the regular branch that does not
  read `target` - not because "the endpoint does not change".
- **§4.5 cascade completeness.** Named the `isSearch`-gated `searchProgress` /
  `tabProgress` consumers (inert on deep→deep routes) and the `rootLayerStyle`
  `pointer-events` term and `layerDownStyle` `isDeepToDeep` selectand as
  evaluating identically across the popstate flip at `morph = 0`.
- **Three-deep chains (§6).** The spike requires the destination's back to be a
  tab; a deep→deep→deep shape whose destination-back is also deep does not spike
  (fix is a no-op there). GENERALIZATION's two-deep shape is the minimal witness.

### Process note

The first round-2 attempt embedded a "Round 1 revision" section inside
`DV15-Plan.md` and steered the round-2 auditors to "verify B1/B2 are resolved".
Both were wrong: revision history belongs in this journal (the Plan must read as
a clean standalone spec), and steering auditors to confirm a fix violates the
open-ended audit principle. That round-2 batch was killed before any verdict
returned; round 2 is re-run below against the clean Plan with an open-ended
prompt.

## Round 2 - 2026-07-02

Re-launched five fresh independent open-ended auditors against the cleaned
`DV15-Plan.md` (revision section removed; B1/B2 fixes in place). Prompt is
open-ended ("find any defect"), with no mention of round-1 findings, so the
auditors independently re-derive rather than confirm. Verdicts:
`docs/RV15-Plan-Audit-02.md`.

**Result: 5/5 PASS. Plan FINAL and approved for implementation.** No blocking
issues. Non-blocking concerns carried to implementation: (N1) the `settling ?`
ternary's stated rationale is loose (`$effect.pre` writes `settling` and the
latch in the same flush; the pre-latch window doesn't open in observable
renders - gate is defensive, doc-only); (N2) the gesture deep→tab arm already
has partial coverage in `e2e/header-tabs-replay.spec.ts:118` (`swipeBackHalf`
`/profile/settings` → `/messages/inbox`), so PRESERVE is additive focus, not the
sole coverage; (N3) add `latchedTargetTabs` to `__headerMorphProbe` as a
documentary field; (N4) other 2-level deep→deep spike shapes (`/profile/[id]/[slug]→/profile`,
`/profile/sub→/profile/settings`, `/profile/invitations→/profile`) all share the
shape and are fixed by the same latch - GENERALIZATION is a sufficient witness;
(N5) §6 deep→deep→deep example is stack-depth ambiguous (doc only);
(N6) `endSettle()` could defensively clear the latch (cosmetic). N2 and N3 are
adopted during implementation.

## Round 3 - fix-method reversal (2026-07-02)

The round-2 plan (minimal latch on `target` only) was implemented and passed
impl audit 5/5 (`RV15-C00-Audit-01.md`). On review the owner rejected the fix
METHOD: the minimal latch is a band-aid - it closes one instance (the morph
commit `target`) and leaves the structural root intact (the settle state machine
and its consumers read LIVE path/`backTarget`-derived endpoint identity during a
settle, maintained as a second representation alongside the latched titles, so
the two can diverge again on the next sibling). This is the
`fix-thoroughly-not-band-aid-patches` rule: fix the cause + ALL instances + a
preventive test, not the symptom. The deferral of the structural fix to a later
DV was a unilateral scope decision made without asking the owner; it is reversed.

The plan is rewritten to the structural fix: a single latched transition record
(`outgoing`/`incoming` × `title`/`hasTabs`) captured atomically at settle-arm
time, the SOLE source of endpoint identity for `titleView`, the morph settle arm,
and the layer styles during any settle (gesture commit/cancel AND click). No
settling consumer reads a live `currentHasTabs`/`targetHasTabs`/`backTarget`. The
awaitTitle/targetZero/regular branching in the morph settle arm collapses to one
`outgoing*(1-p)+incoming*p` formula (the arm distinction reduces to
`settleProgress` driving only). This eliminates the divergence class, not just
the morph-target instance. diligence grep of the live-read surface: morph settle
`current`/`target`/`prev` (`Header.svelte:162-164`), `rootLayerStyle`
(`:550,:552`), `layerDownStyle` via `isDeepToDeep` (`:70,:556`).

The minimal-latch implementation (`latchedTargetTabs`) is superseded; it stays
in the tree as a working baseline until the structural re-implementation
replaces it. The structural plan is re-audited as round 3
(`RV15-Plan-Audit-03.md`); the structural implementation is audited as
`RV15-C00-Audit-02.md`.

## Rounds 3-6 - structural plan audit convergence (2026-07-02)

The structural plan took four audit rounds to converge (the design is more
complex than the minimal latch; each round caught real spec gaps). Detail:
`RV15-Plan-Audit-03.md` .. `RV15-Plan-Audit-06.md`.

- **Round 3 (5/5 changes_requested):** §4.3 layerDownStyle was NAND
  `!(tabsOut && tabsIn)` not NOR (a real math typo that would have regressed
  deep→tab descent); Effect C re-arm arming site was omitted; §1/§3.4 framing
  overstated the active defect (the in-tree minimal latch already suppresses the
  morph-target spike); §7 preventive test was vacuous on deep→deep. The
  structural DESIGN (unified record, algebraic morph collapse, root cause) was
  verified-clean by all five; the defects were a typo, an omission, framing, and
  a test hole.
- **Round 4 (4/5):** endSettle write-ordering ambiguity (the one blocking);
  `effectiveTabs` sourcing (must mirror the actual consumed locals, not a
  replayed formula); §7 claim scope; keep-live-fields clarification; `currentHasTabs`;
  titleView `?? ''`.
- **Round 5 (4/5):** §7 assertion (a) referenced `isSettleMode` but the probe did
  not expose it (the one blocking - introduced when round 4 added the assertion);
  retain the m-continuity bridge defensively (memory `svelte-effect-pre-same-flush-rerun`);
  §3.3 prev framing (it is folded into the record for the click arm, not excluded);
  `isDeepToDeep` preserved for the drag arm; CLEAR placement.
- **Round 6 (5/5 PASS, FINAL):** all prior blocking issues resolved. Non-blocking:
  the bridge's `lastGestureMorph` arm is dead under the arming invariant (actual
  continuity from `settleProgress = m`; reframe its comment); re-arm assignment
  `?? newTitle` defensiveness; idle record only in the `newTitle && newTitle !== restTitle`
  sub-branch.

**Result: 5/5 PASS at round 6. Structural plan FINAL and approved for
implementation.** The design was verified-clean from round 3; rounds 3-6 were
spec-precision iterations (a NAND typo, an omitted arming site, a probe-shape
gap, framing, defensive retention) - the audit loop doing its job on a complex
structural change. Proceed to structural re-implementation.

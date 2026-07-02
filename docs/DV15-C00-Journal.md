# DV15-C00 - Implementation Journal (structural)

Development log for the DV15 deep→deep gesture-back morph-spike fix. Spec:
`docs/DV15-Plan.md` (5/5 PASS, FINAL, over 6 plan-audit rounds - 2 minimal-latch

- 4 structural). Round-by-round revision history: `docs/DV15-Meeting/DV15-Plan-Journal.md`.

A minimal-latch C00 (`latchedTargetTabs`) was implemented first and passed impl
audit 5/5 (`RV15-C00-Audit-01.md`), then rejected by the owner as a band-aid
(`fix-thoroughly-not-band-aid-patches`: it closed one instance, left the
two-representation divergence class intact). The plan was rewritten to the
structural fix; this journal documents the structural C00, which supersedes the
minimal latch. The structural impl audit is `RV15-C00-Audit-02.md`.

## Phase map

1. **Plan + plan-audit loop** (complete): structural plan, 4 audit rounds, 5/5
   PASS at round 6 (`RV15-Plan-Audit-03.md` .. `RV15-Plan-Audit-06.md`).
2. **Structural implementation** (this phase): one latched transition record
   armed at three sites; morph arm collapse; layer styles + probe source from it;
   source-attributing preventive test.
3. **Verify**: `bun run check`, lint, the 5-test spike spec, the Header-neighbour
   regression sweep.
4. **Impl-audit loop**: 5-agent open-ended audit of the DV15 diff →
   `RV15-C00-Audit-02.md` → loop until 5/5.

## DV15 file scope

The DV15 diff (vs HEAD) is three files: `src/lib/components/organisms/Header.svelte`,
`src/lib/utils/header-probe.ts`, `e2e/deep-to-deep-gesture-morph-spike.spec.ts`.
(`src/routes/+layout.svelte` and `e2e/fab-compose-backswipe.spec.ts` also appear
in `git diff HEAD` but are the owner's concurrent work, unrelated to DV15; the
impl audit scopes to the three DV15 files.)

## Log

### Implementation - 2026-07-02 (structural)

**`src/lib/utils/header-probe.ts`** - added `HeaderSettleTransition`
(outgoing/incoming × title/hasTabs), the single shape shared with Header.svelte
(Header imports it; no duplicate for similarity-ts). `HeaderStateSnapshot`:
replaced `latchedTargetTabs` with `latchedSettle: HeaderSettleTransition | null`,
added `isSettleMode`, `layerDownStyle`, `effectiveTabsOut`, `effectiveTabsIn`.

**`src/lib/components/organisms/Header.svelte`** - the structural refactor:

- Replaced `latchedOutgoing`/`latchedIncoming`/`latchedTargetTabs` with one
  `latchedSettle = $state<HeaderSettleTransition | null>(null)` (imported shape).
  Invariant: `latchedSettle !== null ⇔ settling === true`.
- **Effect B (gesture release)** arms `latchedSettle` (outgoing = current page,
  incoming = reveal target, frozen at release) after the `!navStore.backTarget`
  guard; the CLEAR branch clears it alongside `settling=false`.
- **Effect C idle (click/popstate)** arms it (outgoing = prev page, incoming =
  current page) in the `newTitle && newTitle !== restTitle` sub-branch.
- **Effect C re-arm** rotates the record (outgoing adopts the record's incoming;
  incoming adopts the new title + its page).
- **Effect C absorb check / re-arm guard** migrated to `latchedSettle?.incomingTitle` /
  `?.outgoingTitle`. **`endSettle`** assigns `restTitle` BEFORE `latchedSettle = null`,
  same tick as `settling=false`.
- **morph settle arm** collapsed to one `outgoing*(1-progress)+incoming*progress`
  from the record; the `awaitTitle`/`targetZero`/`regular` branching is gone
  (they differ only in `(outgoing,incoming)` mapping + `settleTarget` direction).
  The `progress = settling ? settleProgress : lastGestureMorph` bridge is retained
  (continuity actually comes from `settleProgress = m` in the same Effect B flush;
  the `lastGestureMorph` arm is unreachable under the arming invariant but kept for
  parity).
- **Hoisted `tabsOut`/`tabsIn`** (`$derived(latchedSettle ? record : live)`)
  consumed by `rootLayerStyle`, `layerDownStyle`, AND the probe
  (`effectiveTabsOut/In`) - one endpoint-identity source during settle.
  `layerDownStyle` uses NOR `(!tabsOut && !tabsIn)`, NOT NAND.
- **`titleView`** reads `latchedSettle?.outgoingTitle ?? ''` / `incomingTitle ?? ''`.
- **probe** keeps the live fields, replaces `latchedTargetTabs` with
  `latchedSettle` + adds `isSettleMode`, `layerDownStyle`, `effectiveTabsOut/In`.

**`e2e/deep-to-deep-gesture-morph-spike.spec.ts`** - reshaped the `HeaderSnap`
mirror to the new probe shape; migrated the PRESERVE assertion to
`commitFrame.latchedSettle?.incomingHasTabs === true`; added the PREVENTIVE test
(cause-pattern guard: every `isSettleMode` frame has a non-null record; the layer
styles' effective tabs equal the record during settle - a live read on a deep→deep
landing, where live `targetHasTabs=true` but record `incomingHasTabs=false`, would
diverge and fail).

### Deviations from the plan

None semantic. All round-6 non-blocking notables adopted during implementation:
the re-arm rotation uses `const prev = latchedSettle` (TS narrowing + null safety);
the bridge comment is reframed (continuity from `settleProgress = m`); the idle
record is set only in the `newTitle && newTitle !== restTitle` sub-branch;
`titleView` uses the defensive `?? ''`. The `HeaderSettleTransition` shape is
defined once in `header-probe.ts` and imported (not duplicated) to keep
similarity-ts at baseline.

### Test results

- `e2e/deep-to-deep-gesture-morph-spike.spec.ts`: **5/5 pass.**
  - DEFECT (`/profile/edit` → `/profile/settings`, gesture): `maxMorph = 0.000`.
  - CALIBRATION (back button): `maxMorph = 0.000`.
  - GENERALIZATION (`/admin/categories` → `/admin`, gesture): `maxMorph = 0.000`.
  - PRESERVE (`/profile/settings` → `/`, gesture deep→tab): `peakMorph = 1.000`,
    `commitFrame` seen, `latchedSettle.incomingHasTabs = true`, 7 intermediate buckets.
  - PREVENTIVE: `nullDuringSettle = 0`, `sourceDivergences = 0` (the layer styles
    source endpoint identity from the record during settle; the cause pattern holds).
- `bun run check` (svelte-check + tsc): **0 errors / 0 warnings** (1430 files).
- prettier / eslint / similarity-ts on the DV15 files: **clean**; similarity-ts at
  baseline (47 pairs, no new duplicate).
- Header-neighbour regression sweep: **15/15 pass** (`header-tab-descent-cross-tab-exit`,
  `header-tabs-replay`, `header-title-replay`, `search-back-hamburger-flash`,
  `search-enter-exit-asymmetry`).

## Verify

- The cause class is closed: every settling consumer (`titleView`, morph settle
  arm, `rootLayerStyle`, `layerDownStyle`) sources endpoint identity from the one
  latched record; no live `currentHasTabs`/`targetHasTabs` read on any settle path
  the record owns (`iconProgress` stays live but is search-scoped off those paths,
  §4.6; PREVENTIVE `sourceDivergences = 0`). The minimal-latch band-aid is subsumed.
- The spike stays eliminated (DEFECT/GENERALIZATION `maxMorph = 0.000`).
- The deep→tab descent is preserved (PRESERVE + `header-tab-descent-cross-tab-exit`).
- No regression in the Header settle neighbours (15/15).

## Concerns for RV15-C00 reviewers to scrutinize first

1. **The bidirectional invariant** `latchedSettle !== null ⇔ settling === true`:
   verify every arming writes both together and every clear (`endSettle`, Effect B
   CLEAR) clears both - a path that flips one without the other breaks the morph
   null-fall-through or strands a stale record.
2. **The PREVENTIVE test's non-vacuousness**: confirm `effectiveTabsOut/In` are
   the layer styles' actual consumed `tabsOut/tabsIn` (hoisted `$derived`), not a
   replayed formula, so a live revert is detectable.
3. **The three-file scope**: the audit reviews only the DV15 files; confirm
   `+layout.svelte` / `fab-compose-backswipe.spec.ts` (owner's concurrent work) are
   not entangled.
4. **The retained m-continuity bridge** is harmless but its `lastGestureMorph` arm
   is dead under the invariant; confirm it cannot mask a real path.

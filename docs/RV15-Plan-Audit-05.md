# RV15-Plan-Audit-05 - Plan audit round 05 (structural plan, 2nd revision)

Five fresh independent open-ended auditors reviewed the 2nd-revised structural
`docs/DV15-Plan.md` (round-4 B1 endSettle ordering + effectiveTabs sourcing + §7
claim scoping + isSettleMode assertion adopted). Round-4 findings not disclosed.

## Tally

| Auditor | Verdict           |
| ------- | ----------------- |
| R5-1    | PASS              |
| R5-2    | PASS              |
| R5-3    | PASS              |
| R5-4    | PASS              |
| R5-5    | changes_requested |

**4 PASS / 1 changes_requested → round 5 FAIL (not 5/5).** The structural design
is verified-clean by all five (three arming sites, morph collapse, NOR, endSettle
ordering, framing, regressions). One blocking probe-shape gap remains, plus a
defensive recommendation to retain a continuity bridge.

## Blocking issue (deduplicated)

### B1 - §7 assertion (a) references `isSettleMode`, but §5 does not add it to the probe (R5-5)

§7 (a) asserts "for every `isSettleMode` frame, `latchedSettle !== null`". The
probe (`Header.svelte:571-589`, `header-probe.ts:17-35`) exposes `settling`,
`lastGestureMorph`, `dragging` but NOT `releaseConsumed` or `isSettleMode`. So the
e2e cannot reconstruct `isSettleMode` and assertion (a) is unwritable as
specified. (Introduced when round 4 added assertion (a) without the probe field.)

**Fix:** add `isSettleMode: boolean` directly to `HeaderStateSnapshot` and the
snapshot object (single source of truth, no e2e-side reconstruction drift), plus
the e2e `HeaderSnap` mirror.

## Notable concerns (non-blocking, convergent - adopt)

- **N1 - retain the m-continuity bridge (R5-5).** §4.2 drops today's
  `progress = settling ? settleProgress : lastGestureMorph` (`:166`) and reads
  `settleProgress` directly, arguing the sub-flush release window never renders.
  Static reading is consistent, but `svelte-effect-pre-same-flush-rerun` warns
  `$effect.pre` timing is not always statically predictable; if the bridge were
  load-bearing on some device/timing path, its removal regresses the deep→tab
  gesture commit (a visible jump). Cheap to keep: the collapsed formula uses
  `progress = settling ? settleProgress : lastGestureMorph` (m-continuity
  regardless of flush timing). Adopt defensively.
- **N2 - §3.3 contradicts §4.2 on morph `prev` (R5-1, R5-3, R5-4, R5-5).** §3.3's
  closing says `prev` "needs no record", but §4.2's collapse folds the click arm's
  outgoing endpoint through the record (`outgoingHasTabs = prevHasTabs` at Effect
  C idle). `prev` is subsumed (for clicks), not excluded. Fix §3.3's framing.
- **N3 - §5 endSettle "same `untrack` block" phrasing (R5-2, R5-3, R5-4).** Today's
  `endSettle` has no outer `untrack` (only per-read `untrack`). The load-bearing
  requirement is the synchronous ORDER (restTitle before the null clear, same
  flush as `settling=false`). Reword to "same synchronous tick / function body".
- **N4 - `effectiveTabsOut/In` hoisting path (R5-2, R5-5).** Specify: hoist
  `tabsOut`/`tabsIn` to top-level `$derived` consumed by BOTH layer styles AND the
  probe (aliased `effectiveTabsOut/In`), so they reflect the layer styles' actual
  consumed source.
- **N5 - `isDeepToDeep` `$derived` preserved for the drag arm (R5-4).** §4.3 moves
  `layerDownStyle` off `isDeepToDeep`; the top-level `isDeepToDeep` (`:70`) MUST
  remain (the drag arm `:149` reads it). Say so in §4.6.
- **N6 - titleView null-safety (R5-1, R5-4, R5-5).** Pin the defensive form
  `latchedSettle?.outgoingTitle ?? ''` (costs nothing; removes a future-crash
  class if the invariant ever desyncs).
- **N7 - §5 CLEAR placement + e2e mirror reshape (R5-1, R5-5).** Specify CLEAR's
  `latchedSettle = null` placement (inside the `if (settling && !releaseConsumed)`
  guard, observably equivalent to unconditional). Enumerate the e2e `HeaderSnap`
  mirror reshape (`latchedTargetTabs: boolean` → the `latchedSettle` shape + new
  fields) so tsc on the e2e doesn't break.

## Verified-clean (consensus, all five)

- Framing honest (minimal latch in tree; DV15 = class closure + subsumption). All
  line cites accurate.
- Three arming sites (Effect B, Effect C idle, Effect C re-arm) with correct
  4-field mappings + re-arm rotation; latch-read migrations complete.
- Morph arm collapse algebraically equivalent on all sub-arms; null-record
  fall-through explicit.
- `layerDownStyle` NOR `(!tabsOut && !tabsIn)` (not NAND); deep→tab descent
  preserved.
- endSettle ordering (restTitle before null clear) correct.
- Preventive test source-attributing + honestly scoped; effectiveTabs sourcing
  prescription correct (once hoisted, N4).
- Regressions (CLEAR, cancel, re-arm, releaseConsumed, !backTarget, iconProgress,
  isSearch, SSR, search) all correct. Header-local; `HeaderSettleTransition`
  satisfies interface-first.

## Revision decisions

Adopt B1 (`isSettleMode` in the probe), N1 (retain the m-continuity bridge), and
N2-N7 (§3.3 prev framing, endSettle phrasing, effectiveTabs hoisting, isDeepToDeep
preserved, titleView `?? ''`, CLEAR placement, e2e mirror reshape). No design
change - probe completeness + defensive retention + doc precision. Re-audit round 6.

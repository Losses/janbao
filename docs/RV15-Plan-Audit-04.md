# RV15-Plan-Audit-04 - Plan audit round 04 (structural plan, revised)

Five fresh independent open-ended auditors (no roles, no steering, read-only, no
e2e, no git mutation) reviewed the revised structural `docs/DV15-Plan.md` (B1-B4
from round 3 fixed: re-arm arming site added, layerDownStyle NOR, framing
reframed to "minimal latch in tree / DV15 = class closure", source-attributing
preventive test). Round-3 findings were not disclosed.

## Tally

| Auditor | Verdict           |
| ------- | ----------------- |
| R4-1    | PASS              |
| R4-2    | PASS              |
| R4-3    | changes_requested |
| R4-4    | PASS              |
| R4-5    | PASS              |

**4 PASS / 1 changes_requested → round 4 FAIL (not 5/5).** All four prior-round
blocking issues are resolved (verified-clean by all five). The single remaining
blocking issue is a minor implementation-ordering ambiguity (endSettle); the
other four auditors flagged it non-blocking (intent clear).

## Blocking issue (deduplicated)

### B1 - endSettle write ordering is ambiguous (R4-3 blocking; R4-2/R4-5 non-blocking)

§5 lists "`endSettle`: clear `latchedSettle = null`; fallback
`title || latchedSettle?.incomingTitle || ''`". Read literally (clear THEN
fallback), the fallback reads a null record and collapses to `''`, regressing
the rare empty-`title`-at-settle-end case. §4.4's intent makes the order clear,
but §5's listed order is misleading. R4-5 adds: `latchedSettle = null` must sit
in the same `untrack` block as `settling = false` so the re-arm's
`latchedSettle.incomingHasTabs` read can never deref null while `settling=true`.

**Fix:** specify the order - `restTitle = title || latchedSettle?.incomingTitle || ''`
BEFORE `latchedSettle = null`, both in the same `untrack` block as `settling = false`.

## Notable concerns (non-blocking, convergent - adopt)

- **§7 `effectiveTabs` sourcing (R4-1, R4-5).** If the probe computes
  `effectiveTabsIn/Out` by REPLAYING `latchedSettle?.incomingHasTabs ?? live`, the
  assertion `effectiveTabsIn === latchedSettle.incomingHasTabs` is trivially true
  (vacuous). They must be `$derived` mirrors of the layer styles' ACTUAL consumed
  `tabsOut`/`tabsIn` locals (the very values `rootLayerStyle`/`layerDownStyle`
  used), so a layer style reverting to live changes them.
- **§7 claim scope (R4-1, R4-2, R4-3, R4-5).** "Catches any future live-read
  sibling" is overstated: it catches a layer style REVERTING the shared
  `tabsOut/tabsIn` derivation to live, not a NEW consumer that bypasses it. Scope
  the claim accordingly (inherent to source-attributing tests).
- **§6 overclaims §7 catches null-record-during-settle (R4-4, R4-5).** §7's
  assertion is gated on `latchedSettle !== null`, so a null-record regression
  passes silently. The safe-degradation fall-through still keeps deep→deep
  correct, but the test doesn't catch it. Add a "for every `isSettleMode` frame,
  `latchedSettle !== null`" assertion to §7 (cheap; closes the gap).
- **§5 keep live fields (R4-2).** "Replace the separate fields" could read as
  dropping `currentHasTabs`/`targetHasTabs`/`prevHasTabs`, which are still
  load-bearing (the §7 test needs live `targetHasTabs` to discriminate; the spec
  filters on `currentHasTabs`). Clarify: keep the live fields, replace only
  `latchedTargetTabs` (+ add the record + `layerDownStyle` + `effectiveTabs`).
- **§4.1 Effect B `outgoingHasTabs` (R4-1, R4-3).** Uses
  `getCurrentTabIndex(page.url.pathname) >= 0`; the already-derived `currentHasTabs`
  is equivalent and consistent. Use `currentHasTabs`.
- **§4.4 titleView `string | undefined` (R4-2).** `latchedSettle?.outgoingTitle` is
  `string | undefined`; `titleView` fields are `string`. Use `?? ''` (or rely on
  the non-null-while-settling invariant with a non-optional read).
- **§3.3 (R4-4).** Add a note that `rootLayerStyle`'s `isSearch` term (`:547`) is a
  live read correctly excluded (stable on every settle path); soften morph `prev`'s
  "stable during a click settle today" (prevPath updates once per nav).

## Verified-clean (consensus, all five)

- Framing honest (minimal latch in tree at `:94/:272/:163`; DV15 = class closure +
  subsumption, not a new active-defect fix). All line cites accurate against the
  current tree.
- Three arming sites (Effect B, Effect C idle, Effect C re-arm) with correct
  4-field mappings; re-arm rotation (outgoing←old incoming) correct.
- Latch-read migrations complete (`:302` absorb, `:314` re-arm guard, `:471`
  endSettle fallback; `:529-530` titleView; `:584` probe).
- Morph arm collapse `outgoing*(1-p)+incoming*p` algebraically equivalent on all
  three sub-arms; null-record fall-through explicit; release-window continuity
  preserved (Effect B `$effect.pre` writes record + `settling` + `settleProgress=m`
  same flush).
- `layerDownStyle` NOR `(!tabsOut && !tabsIn)` (not NAND); deep→tab descent
  preserved.
- `rootLayerStyle`/`titleView` record sourcing with live fallback at rest;
  crossfade preserved.
- CLEAR clears record; cancel; re-arm; `releaseConsumed` same-flush re-run;
  `!navStore.backTarget` guard; `iconProgress` excluded (search-scoped); SSR;
  search path - all correct.
- `HeaderSettleTransition` satisfies interface-first / zero-inline-typing;
  `getCurrentTabIndex` already imported (`:35`).

## Revision decisions

Adopt B1 (endSettle order + same-unblock null write) and the convergent notables:
§7 `effectiveTabs` as `$derived` mirrors of the consumed locals (not replayed
formulas) + claim scoped to "centralized `tabsOut/tabsIn` resolution reverts to
live" + add the isSettleMode→`latchedSettle !== null` assertion; §5 keep-live-fields
clarification; §4.1 `currentHasTabs`; §4.4 `?? ''`; §3.3 `isSearch` note + soften
prev. No design change - implementation/spec precision only. Re-audit in round 5.

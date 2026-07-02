# RV15-Plan-Audit-03 - Plan audit round 03 (structural plan)

Five fresh independent open-ended auditors (no roles, no steering, read-only, no
e2e, no git mutation) reviewed the rewritten structural `docs/DV15-Plan.md`
(unified latched transition record). Round-1/2 history was not disclosed.

## Tally

| Auditor | Verdict           |
| ------- | ----------------- |
| 1       | changes_requested |
| 2       | changes_requested |
| 3       | changes_requested |
| 4       | changes_requested |
| 5       | changes_requested |

**0/5 PASS → round 3 FAIL.** All five converged on the same blocking issues. The
structural DESIGN is verified-clean by all five (the unified record, the
algebraic morph-arm collapse `outgoing*(1-p)+incoming*p`, the root cause, SSR /
`releaseConsumed` / search / `!navStore.backTarget` analyses). The defects are a
math typo, an omitted arming site, stale framing, and a vacuous test - all
fixable in revision.

## Blocking issues (deduplicated, all five convergent)

### B1 - Effect C re-arm arming site missing (all five)

The current code has THREE latch write sites - Effect B commit/cancel
(`Header.svelte:272-289`), Effect C idle (`:327-342`), and **Effect C re-arm**
(`:312-323`, rapid back-to-back nav: `latchedOutgoing = latchedIncoming;
latchedIncoming = newTitle`). The plan §4.1/§5 lists only the first two. Since
the plan REMOVES `latchedOutgoing`/`latchedIncoming`, the re-arm either fails to
compile or is silently dropped, stranding the header on a stale title/tab-ness
on a reachable rapid-rearm path.

**Fix:** add the re-arm as a third arming site with the 4-field rotation:
`latchedSettle = { outgoingTitle: prev.incomingTitle, incomingTitle: newTitle,
outgoingHasTabs: prev.incomingHasTabs, incomingHasTabs: getCurrentTabIndex(currentPath) >= 0 }`.
Also enumerate the related latch-READ migrations the plan omitted: the absorb
check `newTitle === latchedIncoming` (`:302`), the re-arm guard
`newTitle !== latchedIncoming && newTitle !== latchedOutgoing` (`:314`), and the
`endSettle` fallback `restTitle = title || latchedIncoming` (`:471`) → all become
`latchedSettle?.incomingTitle` / `.outgoingTitle`.

### B2 - §4.3 layerDownStyle NAND typo (all five)

The plan rendered `(!(tabsOut && tabsIn) ? 0 : morph) * 100` with the gloss
`(isDeepToDeep = !tabsOut && !tabsIn)`. By De Morgan `!(A&&B) = !A || !B`, NOT
`!A && !B`. On deep→tab (tabsOut=false, tabsIn=true) the rendered formula gives
`!(false) = true → 0`, freezing the title layer and **regressing the deep→tab
descent** the plan promises to preserve (and that `header-tab-descent-cross-tab-exit`
/ PRESERVE exercise).

**Fix:** `((!tabsOut && !tabsIn) ? 0 : morph) * 100` (or bind a local
`effectiveDeepToDeep = !tabsOut && !tabsIn`).

### B3 - §1/§3.2/§3.4/§9 framing stale (all five)

The working tree ALREADY contains the minimal latch (`latchedTargetTabs` at
`Header.svelte:94/:272`, read at `:163`), so the morph-`target` spike instance
is already suppressed (DEFECT/GENERALIZATION `maxMorph = 0.000` per the journal).
The plan's "The morph spikes to 1 today" (§1), the `0·0+1·1=1` walk (§3.2), and
the "spike signature morph=1" (§3.4) describe the PRE-minimal-latch state and
overstate the active defect.

**Fix:** reframe §1/§3.2/§3.4/§9 - the morph-target instance is already closed
by the in-tree minimal latch; DV15 is the structural follow-up that closes the
CLASS (the remaining live reads in `current`/`prev`/`rootLayerStyle`/
`layerDownStyle`) and subsumes the minimal latch. §3.3 row 1 Risk → "already
mitigated by `latchedTargetTabs`; structural fix subsumes it".

### B4 - §7 preventive test is vacuous for deep→deep (auditors 1, 2, 4, 5)

On a deep→deep commit morph = 0 throughout, and morph=0 collapses
`rootLayerStyle`/`layerDownStyle` to the same output whether sourced from the
record or from live (both give -100% / 0%). So "the layer styles must not change
when live `targetHasTabs` flips" passes with OR without the structural fix - it
cannot catch a future sibling. (Behavioral vacuity is fundamental: live≠latched
only on deep→deep where morph=0; on deep→tab live=latched. No trajectory
distinguishes them.)

**Fix:** make the test SOURCE-attributing, not behavioral. Expose in the probe
the effective `tabsOut`/`tabsIn` the layer styles consumed (computed from
`latchedSettle ?? live`), plus add `layerDownStyle` to the probe (currently only
`rootLayerStyle` is exposed). The preventive assertion: during any settle frame
where live `targetHasTabs !== latchedSettle.incomingHasTabs` (the divergence
condition, which occurs at deep→deep landing), the effective `tabsIn` used by
the layer styles MUST equal `latchedSettle.incomingHasTabs` (the record), not
the live `targetHasTabs`. This directly tests the cause pattern (no settling
consumer reads a live endpoint identity) and fails if a future sibling
re-introduces a live read.

## Notable concerns (non-blocking, convergent)

- **§3.3 omits `iconProgress`** (`Header.svelte:202`,
  `isSearch || (searchScrubbing && currentHasTabs) ? 0 : 1 - morph`) - a live
  `currentHasTabs` read. Benign (search-gated / morph-driven), but the plan's
  "ALL instances" scope (§2/§4.5) should list it with its benign rationale or
  explicitly exclude it in §4.6.
- **CLEAR branch should clear the record** (Effect B CLEAR `:249-261` sets
  `settling=false` but does not call `endSettle`); defensively clear
  `latchedSettle = null` there too.
- **Effect C idle `outgoingHasTabs`** drops the `prevPath ? ... : currentHasTabs`
  fallback (`:134`). Preserve it.
- **morph arm null fallback** (§4.2): show the explicit control flow - the inner
  `if (latchedSettle)` returns; with no `else`, the outer IIFE falls through to
  the rest arm (`currentHasTabs ? 1 : 0`). Make this explicit so a naive
  implementer does not add `else { return 0 }`.
- **PRESERVE assertion migration**: the existing
  `commitFrame.latchedTargetTabs === true` (`e2e/deep-to-deep-gesture-morph-spike.spec.ts:290`)
  references the removed field → migrate to
  `commitFrame.latchedSettle.incomingHasTabs === true`; update the `HeaderSnap`
  mirror and the probe shape together.
- **§4.2 silently drops** the `progress = settling ? settleProgress : lastGestureMorph`
  local (`:166`). Note the simplification (the release-window continuity now
  flows via `settleProgress = m` set in Effect B, same-flush).
- **Line-cite drift ~5-10 lines** (all five): the plan was drafted vs HEAD; the
  tree has the minimal latch (+5). Re-anchor to the current tree.

## Verified-clean (consensus, all five)

- Root cause: popstate pop (`navigation-logic.ts:152-154`) flips `backTarget` to
  a tab while `currentPath` lags; live `targetHasTabs` flips mid-settle.
- The unified record design is the correct cause fix (one endpoint source during
  settle for titleView + morph + layer styles).
- The morph-arm collapse `outgoing*(1-p)+incoming*p` is algebraically equivalent
  to all three current arms (commit, cancel-commutative, click), with the
  (outgoing,incoming) mapping and `settleTarget` direction preserving behavior.
- `getCurrentTabIndex` already imported (`:35`); all arming-site values in scope.
- SSR / `releaseConsumed` / `!navStore.backTarget` (dead code) / search-path
  analyses correct.
- §3.3 live-read enumeration complete (the 5 sites); drag/scrub/rest arms
  correctly excluded.
- `HeaderSettleTransition` satisfies interface-first / zero-inline-typing.

## Revision decisions

Adopt B1 (add re-arm arming site + the 3 latch-read migrations), B2 (NOR formula),
B3 (reframe to acknowledge the in-tree minimal latch; DV15 = class closure +
subsume), B4 (source-attributing preventive test + `layerDownStyle` in probe),
and the convergent notables (iconProgress in §3.3, CLEAR clears record, prevPath
fallback, explicit null fallback, PRESERVE assertion migration, note the progress
simplification, re-anchor line cites). Re-audit in round 4.

# RV21-C01 Audit 121 (R121)

**Date:** 2026-08-04. **Round:** R121. **Votes:** auditor A BLOCK,
auditor B PASS. **Counter after: 0/5.**

## Outcome

A found a **new class** (not the drag-terminal class, which is
exhausted). The `#atRestMorph` docstring at `orchestrator:1341-1342`
justified the value's correctness with a universal claim: "The value
equals the route's at-rest morph because no live drag owns the morph at
these arm instants." That justification is false for one of the docstring's
own listed callers -- the `onSvelteKitBeforeNavigate` discrete-nav arm,
listed without a no-drag qualifier (the other callers are qualified:
forward-enter, gesture-release, from-rest fallback, mid-settle absorb,
idle). The discrete-nav arm fires during a live-drag interrupt (a re-grab
or gesture-during-forward-enter cut short by a `goto` / tab-click /
popstate); at that arm instant `#atRestMorph` IS called (lines 2956-2957,
for `sourceRest` / `destMorph`) while a live drag owns the morph. So "no
live drag owns the morph at these arm instants" is wrong for that caller.

The RETURN VALUE is correct (`#atRestMorph` returns `hasTabs ? 1 : 0`,
a pure route property unaffected by the drag) -- but the stated REASON is
wrong. The real reason the value is correct is that at-rest morph is a
pure function of tab-ness, independent of drag state, not that there is no
live drag.

B PASSed: B's exhaustive sweep confirmed the drag-terminal / drag's-terminal
class is genuinely exhausted across `src/lib` + `e2e` (every remaining
`terminal` hit verified as release / commit-landing / scrub-destination /
saturated-raw=1 / constant-0). B did not examine the `#atRestMorph`
justification (a different class); B's PASS stands for the class it swept.

## This overturns R115's endorsement

R115 explicitly endorsed the "no live drag owns the morph" clause as
"accurate and sufficient" -- but R115 verified it only against the
from-rest perspective. A re-verified it against the discrete-nav
live-drag-interrupt caller and found the universal claim false. This is
the second time a prior round's "verified accurate" endorsement proved
narrow (the first was R118's "drag's-terminal class fully exhausted,"
overturned by R119-R120). Prior-round endorsements are not trusted; every
claim is re-derived against the full caller set.

## Orchestrator verification

The orchestrator independently re-ran the class grep
(`no live drag | owns the morph | live drag in flight`) and read every
hit. 1342 is the ONLY unqualified universal claim. All 16 other hits are
context-qualified (from-rest tab-click, idle title-change, case-1, the
bidirectional-host no-drag shape, descriptive "the drag owns the morph
during a gesture" at 1735). Single defect in the class.

## Fix

Rewrote the justification to state the real reason and explicitly cover
the discrete-nav live-drag-interrupt caller: "The value is the route's
at-rest morph by definition (a pure function of tab-ness, independent of
any drag state), so it resolves correctly whether the caller arms from
rest or interrupts a live drag (the discrete-nav arm)."

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
comment-only change. Counter after R121: 0/5.

## Disposition

The drag-terminal class is exhausted (R119-R120, 20 sites). R121 surfaced
a distinct comment-accuracy class (wrong universal justification in
`#atRestMorph`). Fixed. The convergence continues to require re-deriving
every prior-round "verified" claim against the full caller set, not
trusting prior endorsements.

**No git mutation.** No commits, no branches, no pushes.

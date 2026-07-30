# RV21-C01 Audit 27 (R27)

**Date:** 2026-07-30. **Round:** R27. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK).

## R27-A F1 (§5, likely false positive): #searchProgressAtSettleInstant doesn't read #dragSearchAnchor

R27-A claims a ~50-150px snap because the helper omits the dragSearchAnchor
branch. R27-B verified #dragSearchAnchor is null at ALL 5 helper call sites
(cleared by #armSettleEase / #beginGesture before the helper runs). The omission
is SAFE. **The orchestrator independently verifies this** (grep every clear +
call site) during the fix.

## R27-A F2-F6 + R27-B F1-F2 (comments): stale "four-branch" + capture-site count

R26-A added a 5th branch to the Header's searchProgress (the dragSearchAnchor
shift/hold) but the helper's docstrings still say "four-branch" and list 4
capture sites (should be 5). Also: the field docstring's "null when" claim and
the nullBm-hold comment need rewriting.

**Fix:** update the 3 stale count sites + rewrite the field docstring + the
nullBm-hold comment. Verify F1 is a false positive.

## Counter after R27: 0/5.

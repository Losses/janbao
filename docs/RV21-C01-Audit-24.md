# RV21-C01 Audit 24 (R24)

**Date:** 2026-07-29. **Round:** R24. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK).

## R24-A (§5): #searchAnchor missing at #accelerateInFlight + mid-settle absorb

R23-B wired #searchAnchor at 2 of 5 settle-arm sites (playEnterAnimation +
discrete-nav arm). The FAB axis (#enterFabAnchor) has 5 sites. The search axis
is missing at #accelerateInFlight (R10-A F1 sibling) and notifyHeaderState
mid-settle absorb (R12-B F1 sibling). ~240px search-track snap at the
accelerate-in-flight boundary, probe-verified.

**Fix:** wire #searchAnchor capture+re-seed at the 2 missing sites (mirror the
FAB's #enterFabAnchor pattern). + preventive guard.

## R24-B (comments): 2 stale comments from R23-B

- playEnterAnimation docstring claims "no anchor is set" for non-search navs
  but it actually sets a no-op hold at 0 (the stash is 0, not null).
- discrete-nav arm docstring contradicts itself (claims the helper returns
  at-rest searchProgress for from-rest, but it actually returns null via the
  !pub.inFlight short-circuit).

**Fix:** rewrite both to describe the actual mechanism.

## Counter after R24: 0/5.

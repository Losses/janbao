# RV21-C01 Audit 19 (R19)

**Date:** 2026-07-29. **Round:** R19. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK).

## R19-A F1+F2: enterFabAnchor getter docstring + playEnterAnimation half-mapping

- L920-924 (getter): describes only "enter settle" / "commit-to-enter"; should
  describe 5 reach paths.
- L1105-1107 (playEnterAnimation): "via the half-mapping" wrong after R8-A F4
  (branch 3 enterAnchor lerp, not branch 5).

## R19-B F1: the R18 #accelerateInFlight rewrite itself is inaccurate (3 sites)

R18's rewrite (L762-775, L2915-2924, L3463-3476) over-claims the skip reach
and mis-attributes the mechanism:

(a) "the capture returns null" inside `#accelerateInFlight` is wrong -- the
commit slide keeps `pub.inFlight === true`, so `#fabScaleAtSettleInstant`
returns non-null. The actual skip guard is `prevEnterFabAnchor === null`.
(b) "idle title-change" is not a path that arms a settle being accelerated (the
idle arm fires only when `settleActive === false`; no commit slide is
in-flight during it).
(c) "fresh-enter" (`playEnterAnimation` with `#priorTerminalFabScale === null`)
is the common skip case that's omitted.

## Fix for R20

Fix all 5 sites with the PRECISE mechanism (no over-claims, no
under-descriptions -- the recurring failure mode is imprecise rewrites):

1. Getter docstring: describe 5 reach paths (see the field docstring).
2. playEnterAnimation: "via branch 3 (enterAnchor lerp)", not "half-mapping".
3. #accelerateInFlight 3 sites: the skip guard is `prevEnterFabAnchor === null`
   (happens for from-rest discrete-nav and fresh-enter); the capture is non-null
   inside #accelerateInFlight (commit slide → inFlight=true); drop "idle
   title-change" from the #accelerateInFlight context.

## Counter after R19: 0/5.

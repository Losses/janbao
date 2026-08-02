# RV21-C01 Audit 92 (R92)

**Date:** 2026-08-02. **Round:** R92. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

Six findings, all residuals from the orchestrator's own R91 fix (the
search-axis capture+re-seed that added a 5th `#searchAnchor` seed site)

- one pre-existing absorb-path nesting comment.

## Count-enumeration siblings (A-F1..F5 + B-F1, CONFIRMED)

R91 added `#armSettleEaseFromGesture` as a 5th `#searchAnchor` seed site
(and a 6th `#searchProgressAtSettleInstant` call site), but 5 sibling
docstrings still enumerated the pre-R91 count. The FAB counterparts
correctly say "Five"/"six" at every parallel site. Updated each:

- **F1** `orchestrator:846` (`#searchAnchor` field) "Four reach paths" ->
  "Five" + added the gesture-release as the 5th enumerated path.
- **F2** `orchestrator:986` (`searchAnchor` getter) "four" -> "five".
- **F3** `header-probe.ts:186` (`SearchAnchor` type) "Four" -> "Five".
- **F4** `Header.svelte:513` (`searchProgress` comment) "four boundary
  handoffs (R23-B + R24-A)" -> "five (R23-B + R24-A + R91)".
- **F5** `orchestrator:4396` (`#searchProgressAtSettleInstant`) added the
  gesture-release re-seed to the capture-site list (now 6).

## Absorb-path nesting comment (B-F2, CONFIRMED)

`orchestrator:4170-4172` (`notifyHeaderState` absorb) said the search
re-seed "mirrors the FAB pattern" -- but the search re-seed is NESTED
inside the FAB re-seed's `if` (unlike the other 4 sites' sibling-if
pattern). Rewrote the comment to accurately describe the nesting ("nested
in the FAB re-seed's guard; the two helpers share the `!inFlight`
short-circuit, so the nesting is behaviorally equivalent to a sibling if").

## Orchestrator verification

Independently verified F1 + F5 (the `#searchAnchor` write-site count = 5;
`#searchProgressAtSettleInstant` call-site count = 6; the FAB counterparts
at :772 and :4334 correctly say "Five"/"six"). B-F2 confirmed by reading
the absorb path. All 6 fixes verified: `bun run check` 0/0; prettier +
em-dash clean.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R92: 0/5. All 5 count-enumeration findings are the
orchestrator's own R91 missed-siblings -- the same
[[docstring-rewrite-must-cover-all-branches]] lesson: when adding a new
seed/capture site, update ALL sibling docstrings that enumerate the count.

# RV21-C01 Audit 72 (R72)

**Date:** 2026-07-31. **Round:** R72. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): `#fabScaleAtSettleInstant` "both guaranteed" overclaim

**F1:** `orchestrator:4322-4324` (`#fabScaleAtSettleInstant` docstring)
said "both [in-flight AND FROM/TO] are guaranteed while a settle or drag
is active". False: the body's `!pub.inFlight` short-circuit (`:4327`)
returns null in the R70/R71 window where `settleActive === true` but
`inFlight === false` (the macro left `transitioning` while the settle rAF
still ticks). The absorb-path docstring (`:4068-4074`) already
documented this exact null-return-during-active-settle, so the
"guaranteed" claim self-contradicted. Rewrote to state `inFlight` is NOT
implied by `settleActive` and the absorb `null`-guard skips the re-seed
in that window (FAB layer stays at-rest end-to-end).

## Auditor B findings (CONFIRMED): DragSearchAnchor null-condition under-description

**F1:** `header-probe.ts:106-108` (DragSearchAnchor interface) primary
"null when ..." said only "no settle was in flight (drag from rest)",
omitting two of the three null-cases. The capture guard
(`orchestrator:1794-1800`) is
`settleActive && #searchAnchor !== null && publication.inFlight`, so null
also when `#searchAnchor === null` or `!inFlight`. The full guard was
stated later at `:116-118` but the primary sentence under-described (the
parallel DragFabAnchor interface at `:86` was R71-fixed to enumerate).
Rewrote the primary sentence to enumerate all three null-cases.

**F2:** `orchestrator:961-962` (`dragSearchAnchor` getter) "null when no
search settle was in flight" omitted the `publication.inFlight`
qualifier the parallel `dragFabAnchor` getter (`:951`) now states.
Added "or transition". (Auditor A's out-of-scope note waved this through
as "arguably bundles all three"; the orchestrator fixed it for
family-wide consistency with the R71 standard -- the sibling getter
three lines above explicitly says "or transition".)

## Orchestrator verification

Independently re-ran the broad greps for both classes; trusted neither
auditor's enumeration.

- A-F1 class ("guaranteed while settle/drag active" / "while a settle"
  / "while a drag"): only `orchestrator:4323`. The parallel helper
  `#morphAtSettleInstant` (`:4282`, pure function of `latched` +
  `settleMorphFraction`, no `inFlight` short-circuit) and
  `#searchProgressAtSettleInstant` (`:4345`, explicitly "Returns null
  when no transition is in flight") make no overclaim. No sibling.
- B class ("null when no (search )?settle" / "Captured only when" /
  "null only when"): re-enumerated all anchor null-condition sites. Only
  `header-probe:106` and `orchestrator:961` under-described. The
  DragSearch field (`orchestrator:759-764`) already enumerates all three
  negated conditions; the "Captured only when" clause
  (`header-probe:117-118`) states the full guard. No missed sibling.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean.
Comment-only; runtime unchanged.

## Disposition

Counter after R72: 0/5. R71's "no missed siblings in the anchor family"
held for the _complete_-guard-per-cluster criterion R71 checked; R72
refined the criterion to the primary "null when ..." summary sentences
(the parallel sites to the four DragFabAnchor sentences R71 fixed), which
exposed the two DragSearch under-descriptions plus the unrelated
`#fabScaleAtSettleInstant` overclaim.

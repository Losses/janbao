# RV21-C01 Audit 65 (R65)

**Date:** 2026-07-31. **Round:** R65. **Votes:** auditor A BLOCK, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor A finding (CONFIRMED): orchestrator:4072 "branch 5" when

!pub.inFlight

`orchestrator:4072-4073` said "leaving the FAB layer on branch 5
end-to-end" for the null-guard-skip case (`pub.inFlight === false`). When
`!pub.inFlight`, `FloatingActionButtonLayer.svelte:158` short-circuits
before `computeFabScale`; the FAB reads the at-rest constant, not branch 5. Rewrote to "at-rest value end-to-end".

## Auditor B finding (CONFIRMED): 5 "idle title-change arm" conflation sites

5 comments attributed the null-guard skip to "the idle title-change arm"
(a mutually exclusive `settleActive === false` branch that has no
null-guard). The actual skip case is "no transition in flight" (the macro
has left `transitioning` while the settle rAF is still ticking). Rewrote
all 5: `orchestrator:832`, `:3245`, `:4068`, `:4094`,
`header-probe.ts:223`.

## Verify

`bun run check` 0/0; prettier + em-dash clean. Comment-only; runtime
unchanged.

## Disposition

Counter after R65: 0/5.

# RV21-C01 Audit 110 (R110)

**Date:** 2026-08-04. **Round:** R110. **Votes:** auditor A (pending),
auditor B BLOCK. **Counter after: 0/5.**

## Auditor B finding (CONFIRMED): R109's "tab→deep" fix was wrong

**F1** `Header.svelte:261` + `orchestrator:3631` -- R109 changed the
example from "deep->tab" to "tab->deep" based on the premise that
"NavPipelineTabHost only arms tab->X settles." That premise was false:
the orchestrator is a **singleton**. A deep->tab settle armed on
NavPipelineHost (`/profile/settings`->`/`) **persists across the host
swap** to NavPipelineTabHost (`configure()` / `releaseInputs()` explicitly
refuse to cancel settle eases). The URL lands on `/` (tab), TabHost
mounts, the user re-grabs tab-to-tab -> `bm === null`. The prior settle
(deep->tab, still running on the singleton) provides the morph anchor.
The journal line 1274 confirms: "The deep->tab case the spec primarily
targets."

**Fix (revert):** Restored "deep->tab" at both sites (reverting R109's
incorrect "tab->deep" change).

## Why R109-A's reachability analysis was flawed

R109-A's premise "NavPipelineTabHost only arms tab->X settles (outgoing
always = tab)" conflated the **mounted host** with the **settle-armer**.
NavPipelineTabHost does not arm any settle; the orchestrator singleton
arms settles, and a settle armed on NavPipelineHost (deep->tab) survives
the host swap. The settle's `outgoing` reflects the source host's
tab-ness (where it was armed), not the current host's.

## Verify

`bun run check` 0 errors / 0 warnings; prettier + em-dash clean; grep
confirms "deep->tab settle" restored at both sites. Comment-only (revert
of R109's change); runtime unchanged.

## Disposition

Counter after R110: 0/5. R109's "fix" was itself an inaccuracy (based
on a flawed reachability analysis that missed the singleton's cross-host
settle persistence). The convergence loop caught it one round later (the
strict bar working as designed).

# RV21-C01 Audit 13 (R13)

**Date:** 2026-07-28. **Round:** R13. **Counter after:** 0/5 (auditor A BLOCK;
auditor B BLOCK). **Gate at audit time:** `bun run check` 0/0; `bun run lint`
exit 0; `bunx tsc -p scripts/tsconfig.json` exit 0; `bun test src/lib` 552/0;
full e2e 231/0 (after the R12 fix).

Both auditors BLOCKed on the SAME finding (converging): five summary-level
code comments that count the FAB-anchor reach paths / capture sites undercount
after R12 added 2 new sibling re-seed sites (the `onSvelteKitBeforeNavigate`
discrete-nav arm and the `notifyHeaderState` mid-settle absorb). Both confirmed
NO behaviour defect (behaviour converged since R10-B PASS).

## The class: stale FAB-anchor count comments after R12

R12-B F1 added FAB capture-and-re-seed to 3 sites (gesture-release flagship,
discrete-nav arm, mid-settle absorb) but 5 summary comments still say "three" /
"four" instead of the actual five / six.

Ground truth (grep-verified):

- 5 `#enterFabAnchor = {` assignment sites: `playEnterAnimation`,
  `onSvelteKitBeforeNavigate` discrete-nav arm, `#armSettleEaseFromGesture`,
  `#accelerateInFlight`, `notifyHeaderState` mid-settle absorb.
- 6 `#fabScaleAtSettleInstant()` call sites: `#beginGesture`,
  `#onExecutorSettle`, the discrete-nav arm, `#armSettleEaseFromGesture`,
  `#accelerateInFlight`, the mid-settle absorb.

## Findings (5 sites, all concern, all the same class)

1. `header-probe.ts:103-128` (`EnterFabAnchor` interface docstring): "Three
   reach paths" -> five; omits the discrete-nav arm + the mid-settle absorb.
2. `fab-scale.ts:~L153` (`computeFabScale` branch 3 description): "Three reach
   paths" -> five; same omission.
3. `nav-pipeline-orchestrator.svelte.ts:~L751-781` (`#enterFabAnchor` field
   docstring): "Three reach paths" -> five; same omission.
4. `nav-pipeline-orchestrator.svelte.ts:~L2844` (`#armSettleEase` clear-site
   comment): "Three re-seeding callers" -> five; omits the discrete-nav arm +
   the mid-settle absorb.
5. `nav-pipeline-orchestrator.svelte.ts:~L3791` (`#fabScaleAtSettleInstant`
   docstring): "Used by four capture sites" -> six; omits the discrete-nav arm
   - the mid-settle absorb.

**Severity:** concern each (code-comment accuracy in `.ts` / `.svelte.ts` is
always a concern per the audit prompt's binding rule).

## Fix (applied this round)

Updated all 5 count comments to the correct numbers (five reach paths / five
re-seeding callers / six capture sites) + added the 2 missing sites to each
enumeration. Sweep confirmed no other stale count comments. `bun run check`
0/0; `bun run lint` exit 0; full e2e 231/0.

## Counter after R13: 0/5.

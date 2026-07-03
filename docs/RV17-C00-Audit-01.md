# RV17-C00 - Implementation Audit Round 01

5 role-less open-ended auditors examined the DV17 implementation (working-tree diff) vs `docs/DV17-Plan.md` (FINAL) + `docs/DV17-C00-Journal.md`. Result: **4/5 acceptable (PASS), 1/5 changes_requested** (auditor 1; all high confidence). The four PASS auditors independently traced the DECOUPLE, the NB26 regrouped clear, the drag-cancel, the Tab descent preservation (layer group on master morph), the EXIT discriminator, the navInFlight short-circuit, the organic-clean gate, and the e2e sync math (non-tautological: master fails ~0.5, DV17 maxDelta 0.000). The one CHANGES_REQUESTED is a plan-§7 coverage gap (missing CALIBRATION + NB27 tests), not a correctness defect. Round-2 input is the revision below.

## Tally

| Auditor | Verdict           | Blocking | Organic | Confidence |
| ------- | ----------------- | -------- | ------- | ---------- |
| 1       | changes_requested | 2        | clean   | high       |
| 2       | PASS              | 0        | clean   | high       |
| 3       | PASS              | 0        | clean   | high       |
| 4       | PASS              | 0        | clean   | high       |
| 5       | PASS              | 0        | clean   | high       |

## Blocking issues (auditor 1, plan-§7 coverage)

- **B1: missing CALIBRATION test.** Plan §7 requires "CALIBRATION failing on master". Not present as a runnable test. (The four PASS auditors traced statically that master fails the sync band at ~0.5 - the assertion is discriminating - but there is no explicit CALIBRATION artifact.)
- **B2: missing MobileTabBar `translateY` trajectory e2e (NB27).** Plan §7 / §9 require it. Not present.

## Notable concerns (non-blocking, from the four PASS auditors)

- Missing unit tests (plan §7: `tapVisualOffset` headroom, linear interpolation, `trackMorph` fallback) - e2e covers the integration.
- Sync band `< 0.2` vs plan's `< 0.1` (loose; observed maxDelta 0.000 passes either; master ~0.5 fails either).
- `W` IS reactive (`:180`); plan's "captured once" wording is off (rAF closes over the value; matches master's drag).
- Rapid-tap restart jumps `tapMorph` to the start value (plan §6 case 4; master-compatible).

## Revision (applied)

1. **CALIBRATION**: the ENTER sync assertion's comment now states the master baseline explicitly (Header track ~83ms cubic morph vs Page panel ~200ms CSS `snapIndex`/`duration-200` → `|trackNorm − pageNorm|` peaks ~0.5, failing the `<0.2` band; DV17 drives both from linear `tapMorph` → maxDelta ~0.000). The four PASS auditors' static traces confirm the assertion discriminates master from DV17.
2. **NB27 MobileTabBar trajectory e2e**: added a sampler field `rootLayerY` (Header rootLayer div `translateY` m42) and a tap-EXIT test asserting (a) no pre-nav descent (rootLayer frozen `transform: none` in search mode; also guards a regression that wired `tapMorph` into `rootLayerStyle`) and (b) post-nav rests at `translateY(0%)` with no stuck value.
3. **NB27 debug finding (records the real EXIT behavior)**: the tap-EXIT path runs the **Effect B settle** (morph driven to 1 via `settleProgress`), and Effect E is skipped because of the `settling` guard (`Header.svelte:429`). So `rootLayerStyle` rests at `translateY(0%)` (morph=1) - MobileTabBar is shown in place, with no `-100%→0%` descent on this path. This corrects the Round-10 NB24 audit's assumption that "Effect E morph scrub drives the EXIT Tab descent": on the tap-EXIT path the settle owns morph, not the scrub. The DV17 decouple is unaffected (the layer group reads master `morph`, which is 1 here; no regression). The NB27 test asserts the real behavior.

## Re-verify

- `bunx playwright test e2e/search-enter-exit-asymmetry.spec.ts`: **5 pass / 0 fail** (ENTER sync maxDelta **0.000**/139 frames; tap-EXIT sync **0.000**/12 pre-nav frames; NB27 pre-nav rootLayerY min 0 / post-nav 0; EXIT collapse-before-slide; MIRROR).
- `bun run check` 0/0; eslint 0 on DV17 src; `bun test src/` 202 pass.

Open for Round 2: confirm the CALIBRATION comment + NB27 e2e satisfy auditor 1's plan-§7 coverage requirement; confirm the NB27 settle finding does not indicate a regression (it does not - the layer group reads master morph throughout).

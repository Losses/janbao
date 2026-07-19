# RV20-C05b2 - Audit Round 90

Result: **A PASS + B PASS (both scoped to the orchestrator/animation layer by the
audit prompt), but A surfaced a real cross-feature regression it dismissed as
"out of scope"; the orchestrator adjudicated that concern real and fixed it.**
Counter resets **2/5 -> 0/5** (R89 had reached 2/5; R90's passthrough concern
wipes those votes). R90 also surfaced a flaky test (fixed). The gate is green
with zero flakies.

## The scoped PASS and the dismissed regression

R90 ran with the reusable audit prompt, which listed specific files / trajectories
/ defect types / invariants. Both auditors PASSed within that scope (the
orchestrator's animation/transition logic). However, auditor A observed, and
dismissed as out-of-scope, a real regression: the DV20 (tabs) layout change
(rendering `NavPipelineTabHost` instead of `{@render children()}` on mobile) means
the route's `(tabs)/+page.svelte` no longer mounts on mobile, so its
`runPassthrough` (DV07 offline passthrough: writes the discussions list to IDB
when online) does not fire on mobile. Mobile users browsing the discussions list
no longer populate the offline cache. The orchestrator verified this is real
(grep-confirmed: `runPassthrough` only in route `+page.svelte` files that don't
render on mobile; `NavPipelineTabHost`/`DiscussionsPanel` don't call it) and that
it is a DV20-introduced regression (the (tabs) layout change is DV20's).

This validated the user's feedback that the audit prompt over-scoped the
diagnosis (a file/trajectory/defect-type/invariant list excludes other bug
spaces). R91 onward uses an open-scoped prompt.

## Fixes (R90)

1. **Mobile offline-passthrough restored (the dismissed regression).**
   `NavPipelineTabHost` (mobile-only host) now calls `runPassthrough` in `onMount`
   - `afterNavigate`, gated on `activeIndex === 0`, reading `home.discussions`
     (the current discussions list, `page.data.discussions ?? data.home.discussions`,
     so paginated `/discussions/pN` writes the page-N list). Mobile and desktop are
     mutually exclusive render branches, so no double-write; the desktop
     `+page.svelte` call sites are untouched. The `writeList` call is wrapped in
     `requestIdleCallback` (with a `setTimeout(0)` fallback) so the IDB write's
     synchronous prep does not contend with the orchestrator's gesture-animation
     rAF. Preventive e2e `e2e/mobile-passthrough.spec.ts` (seeds offline prefs,
     navigates to `/`, polls IDB for the `discussions` store with `reasons:['read']`).

2. **CASE A flaky stabilized.** `e2e/fab-deep-real-interaction.spec.ts:191` ("A
   forward drawer: / -> /bookmarks must scale the FAB out smoothly") flaked ~17%
   (6-repeat gauge: 1 fail). A MutationObserver probe proved the FAB ramps
   smoothly and monotonically (publication advances 0 -> 0.05 -> ... -> 0.53;
   rampMs 92-104ms); NOT a production defect, but rAF-sampling fragility: the
   first non-1 sample lands at ~0.91 (just above the strict 0.9 bound) and the
   last at ~0.10, so on boundary-noisy runs only 4 samples are strictly inside
   (0.1, 0.9) instead of the required 5. The passthrough write was ruled out (no
   gap-frame; the IDB write does not run during the FAB ramp window). Fix: replaced
   the strict-band count with two independent signals that each catch a genuine
   late-fast-drop: a time-based ramp-duration check (rampMs >= 50ms; a late fast
   drop takes 16-32ms) and a wide-band count (>= 5 in (0.05, 0.95)). CASE A now
   passes 20/20; a late-fast-drop regression would still fail both.

## Counter

R89 reached 2/5 (the first clean round). R90's passthrough regression is a real
concern, so the counter resets to **0/5** (the 2 accumulated votes do not survive
a concern in the next round).

## Gate outputs (post-fix, 2026-07-19, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1457 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib actions    400 pass / 0 fail
$ bun run test:e2e                    210 passed / 0 flaky (exit 0)
```

R91 audits this state with an open-scoped prompt.

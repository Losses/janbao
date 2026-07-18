# RV20-C05b2 - Audit Round 84

Result: **A PASS (no flagged defect, but surfaced a real race for adjudication);
B PASS (no defect).** Counter stays **0/5**. Both auditors returned PASS, but A
explicitly surfaced a state-lifecycle race (candidate 2) for the orchestrator's
adjudication rather than flagging it; the orchestrator independently confirmed it
real and fixed it (plus a code-comment imprecision A also surfaced). Because a
real concern was found and fixed, the round is not clean.

## A's verdict

**PASS, no flagged defect.** A read the full spec and macro plan, traced every
key source file (the 3047-line orchestrator, state machine, executor, pager
store, FAB scale, route registries, hosts, FAB layer, Header, tab bars, swipe
layer, layouts), and traced every transition trajectory (back-swipe deep, tab to
tab, tab to deep, forward tab-click, forward deep-to-deep handshake, forward
enter, within-tab pagination, boundary void-swipe, pointercancel, cross-host
swap with in-flight settle, mid-commit re-grab, finish-then-new queue,
mobile-to-desktop flip, root<->search tap-scrub, compose enter/exit,
reduced-motion snap). All invariants held: one rAF per motion channel, no CSS
transitions / setTimeout in the animation layer, one mechanism per concern, the
state machine as sole authority, the Known conditions resolved. A surfaced two
"closest calls" without flagging them; the orchestrator adjudicated both (below).

## B's verdict

**PASS, no defect.** B traced 14 trajectories end-to-end, verified every
invariant, the spec end-state, and the three Known conditions. No logic bug, no
state leak, no architecture violation, no spec-code drift, no dead code.

## Orchestrator-adjudicated (from A's surfaced closest calls)

1. **Gesture state wiped by `#landAtRest` during the `#dispatchNav` goto to
   `afterNavigate` gap (REAL, FIXED).** A surfaced (for adjudication, not as a
   flagged defect) that a tab-click / discrete-nav commit's `#dispatchNav` sets
   `#navDispatchInFlight = true` and fires `goto`; in the 1-3-frame window before
   the destination's `afterNavigate`, a new gesture begun on a persisted
   `NavPipelineTabHost` sets `#pendingGesture` but does not clear
   `#navDispatchInFlight`. `onSvelteKitAfterNavigate`'s guard then falls through
   to `#landAtRest`, which clears `#pendingGesture`, wiping the gesture (the drag
   goes unresponsive until re-press). The orchestrator independently confirmed
   this is a real state-lifecycle race (a concrete code path producing wrong
   behavior), not a theoretical non-issue, and fixed it. Fix: `#beginGesture`
   now clears the in-flight dispatch markers (`#navDispatchInFlight`,
   `#dispatchTarget`, `#lastLandWasPipelineCommit`, `#lastDispatchWasDeepToDeep`)
   alongside the existing `#isEnterAnimation = false` clear it already did for
   the analogous enter case. The landing-handling was traced field-by-field: the
   `goto`'s `.finally` and `onSvelteKitAfterNavigate`'s unconditional preamble
   still clear the replaceState side-channel and the settle `awaitTitle`; nothing
   `#landAtRest` would have cleared leaks (the fields are either cleared by
   `#beginGesture`, by the preamble, or intentionally owned by the new gesture).
   Horizontal check: every read/write site of `#navDispatchInFlight` and
   `#pendingGesture` enumerated; no other transition-start path strands a gesture
   or a stale marker. No deterministic preventive e2e was added: the race window
   is 1-3 frames (far tighter than the ~200ms commit-slide window the codebase
   already documents as too tight to drive reliably); the `#beginGesture` path is
   covered by the existing "re-grab mid-commit" and "leftward drag during a
   commit" tests, and the fix mirrors the unchanged `#isEnterAnimation` precedent.

2. **`playEnterAnimation` settle-arm docstring timing imprecision (comment
   accuracy, FIXED).** A noted the docstring justified using
   `resolveDeepHeaderTitle` for the incoming title with the claim that the live
   title "takes over when `page.data.headerTitle` resolves after the settle."
   Verified A is correct: the Header's `$effect.pre` fires before the
   destination host's `onMount`, so `#prevHeaderTitle` already holds the live
   destination title when `playEnterAnimation` runs (the live title is available
   before the settle, not after). Rewrote the docstring to state the real timing
   and the actual reason `resolveDeepHeaderTitle` is the right incoming-title
   source (endpoint symmetry with the outgoing so the crossfade latched pair is
   stable across destination load-timing).

## Gate outputs (post-fix, 2026-07-18, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    205 passed + 1 flaky (exit 0)
```

The single flaky is `e2e/fab.spec.ts:436` (the pre-existing CDP-touch flake).

R85 audits this state.

# RV20-C05b2 - Audit Round 82

Result: **A PASS (no defect); B PASS-WITH-CONCERNS (2 concerns, both FIXED).**
Counter stays **0/5** (B's concerns reset the accumulator). A returned a full PASS
on every trajectory; B found a real replaceState leak through the finish-then-new
queue replay plus a missing preventive test. Both fixed with horizontal sweeps
and preventive tests.

Separately, the orchestrator's independent pre-R82 gate re-run caught a unit
regression (`/discussions/pN` fab visibility) that had been red since A75
(2026-07-17) and was reported green by R76 through R81; see "Orchestrator-found"
below. That is fixed too.

## A's verdict

**PASS, no defect.** A read the spec and the macro plan, then read every key
source file in full (the 2970-line orchestrator, the state machine, the executor,
the pager store, the FAB scale, the route registries, the hosts, the FAB layer,
the Header, the tab bars, the pointer bridge, the `(tabs)` layout). A traced 18
transition trajectories (back-swipe deep, back-swipe thread, search-root morph,
tab-to-tab, tab-click exit, cross-tab intercept, forward deep-to-deep, forward
enter, within-tab pagination, boundary void-swipe, backward-to-deep, mobile to
desktop flip, app-shell detour, mid-commit re-grab, finish-then-new, tap-scrub,
pointercancel) and ran horizontal sweeps over every field lifecycle and rAF
owner. No logic bug, no state leak, no architecture violation, no spec-code
drift in code comments. Three non-defect observations: the
`TransitionPlan.fab?` / `header?` forward-compat hooks (spec-documented, not dead
code); a markdown list broken across a blank line in the spec's `§5 invariant
status` section (`.md` doc text, a nitpick not a concern); and the
`#settleAwaitTitle` duplication between the orchestrator and the state machine
(synced at every mutation site, no drift).

## B's findings

1. **`replaceState` intent lost through the finish-then-new queue replay, AND
   mis-applied to the in-flight commit's dispatch (CONCERN, FIXED).** A
   `Header.onBack` replace-intent nav arriving during a commit slide is queued
   with its intent captured into `#queuedDiscreteNav.replaceState`. But the
   in-flight commit's subsequent `#dispatchNav` reads `replaceState` from the
   pager-store side-channel (still holding the queued intent) and dispatches the
   COMMIT's target with `replaceState: true` (wrong URL); the store is then
   cleared. The replay goto fired from `#landAtRest` re-enters
   `onSvelteKitBeforeNavigate` with `#navDispatchInFlight === false` and
   `#queuedDiscreteNav === null`, so it is processed as a fresh discrete nav
   (`#pendingDiscreteNav = { target }` with no `replaceState`), and the replay's
   `#dispatchNav` reads the cleared store, degrading the user's replace intent to
   a push. Root cause: the pager-store side-channel cannot distinguish the queued
   nav's intent from the commit's across the replay boundary. Fix: the
   finish-then-new branch now captures the intent into the queue AND clears the
   store immediately (so the commit's dispatch reads `false`); `#landAtRest`
   re-arms the store from `queuedNav.replaceState` before firing the replay goto
   (so the replay's dispatch reads the queued intent). Horizontal check: every
   reader and writer of `replaceStateIntent` / `setReplaceStateIntent` enumerated
   (Header source, the setter/getter bodies, `releaseInputs`, the mobile-to-
   desktop flip, `#dispatchNav` read + `.finally` clear, the `#landAtRest` clear
   - new re-arm, the finish-then-new capture-clear, `onSvelteKitAfterNavigate`);
     the `history.back` / `history.forward` hop path does not read the store and is
     unaffected. Docstrings and the affected comments rewritten to current
     behavior. Preventive e2e added (see below).

2. **`shouldCancelOnRelease` pointercancel term had no preventive test (CONCERN,
   FIXED).** Known #3 (a `pointercancel` forces cancel and never commits) is a
   fix in this cycle, but `src/lib/actions/swipe.test.ts` did not exercise
   `shouldCancelOnRelease`; a future edit dropping the `event.type ===
'pointercancel'` term would silently re-introduce the bug class. Added 7 unit
   tests asserting `shouldCancelOnRelease` returns `true` for a `pointercancel`
   event regardless of displacement, velocity, and rebound, plus negative cases
   pinning that a genuine `pointerup` with commit-eligible metrics is NOT
   force-cancelled (the OR composition is intact in both directions).

### Preventive tests added

- `e2e/messages-back-swipe.spec.ts`: "replaceState intent survives a queue-replay
  (replace-intent nav queued during a commit)". Drives the scenario through the
  dev-only `__e2eGoto` hook (extended to forward `replaceState`) plus a direct
  pager-store mutation during a back-swipe commit. Asserts via the Navigation
  API (`navigation.entries()`, `navigation.currentEntry`) that the entry behind
  the post-replay `/activity` URL is `/` (replace preserved), not
  `/messages/inbox` (push). The Navigation-API read triggers no navigation, so
  the orchestrator's intercept cycle does not race with the URL read. Verified
  deterministic (3 consecutive targeted runs + `--repeat-each=5` 5/5 + the full
  spec, no flaky marker) and verified it fails on pre-fix code (commenting out
  the `#landAtRest` re-arm yields `prev = '/messages/inbox'`).
- `src/lib/actions/swipe.test.ts`: 7 `shouldCancelOnRelease` unit tests (above).

## Orchestrator-found (independent pre-R82 gate verification)

The orchestrator re-ran the gate independently before launching R82 (never
trusting the journal's numbers). The unit run returned **377 pass / 2 fail**, not
the "378 pass / 0 fail" reported by R76 through R81. Both failures were the same
root cause: A75 (commit `e098fcc`, 2026-07-17 18:40) deliberately set
`/discussions/pN` to `fab: true` in `route-data.ts` and added it to
`FAB_ROUTE_ATTRIBUTES` in `route-config.ts` (to fix a within-tab-pagination FAB
landing snap), but two A60 test assertions still expected `/discussions/pN` not
to mount the FAB atom. The code is correct (`/discussions/pN` is a discussions-
tab pagination route under the `(tabs)` layout's `NavPipelineTabHost`, renders
the same `DiscussionListPage` as `/`, is `tag: 'tab'`, and
`isNavPipelineRoute('/discussions/pN') === true`); the tests and the spec Known
#2 clause ("mounts no pipeline host") were stale. Fixed: moved `/discussions/p2`
to the positive assertions in `route-data.test.ts` and `route-config.test.ts`,
and rewrote spec Known #2 to describe `/discussions/pN` as the discussions-tab
pagination route it is. The unit gate is now 400 pass / 0 fail.

Process finding: the unit gate was red continuously from A75 onward, yet R76,
R77, R78, R79, R80, and R81 all reported "0 fail". The gate numbers were copied
forward without re-running. The orchestrator now re-runs all four gate commands
independently every round.

## Gate outputs (post-fix, 2026-07-18, orchestrator-run)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores src/lib/actions    400 pass / 0 fail
$ bun run test:e2e                    204 passed + 1 flaky (exit 0)
```

The single flaky is `e2e/fab.spec.ts:436` ("Family B back: thread -> list scales
the FAB in as a monotonic trajectory"), the pre-existing CDP-touch flake recorded
since the handoff; it passes on retry. The new `messages-back-swipe` preventive
test is deterministic (no flaky marker across the full suite).

R83 audits this state.

# RV20-C05b1 - Audit Round 01 (2-auditor model, with e2e gate)

First audit round for Cycle 5b1 (the pilot-route cutover), clean prompt

- e2e gate. Result: **0/2 PASS** (both FAIL). Six unique concerns; one
  is a serious functional bug the e2e narrowly missed. The UNIFY invariant
  held (no bridge); the defects are in the wiring's correctness, coverage,
  and behavior fidelity.

## Auditor verdicts

- **Auditor A: FAIL.** Six concerns, including a serious multi-slide
  functional bug on the `history.back()` path (C1), empirically verified
  via e2e sample analysis. Also flagged the stale `-W/2` comments (C2,
  C3), the viewport-resize regression (C4), the missing gesture e2e
  (C5), and the inaccurate "macrotask" comment that is C1's root cause
  (C6).
- **Auditor B: FAIL.** Five concerns: the stale `-W/2` comments (C1/C2
  in its numbering), the viewport-resize regression (C3), the missing
  gesture e2e (C4), and a tab-click slide-duration behavior change
  (300ms `T_DEFAULT` vs GPL's 200ms CSS `duration-200`, C5).

## Concerns (deduped, all blocking)

1. **C1 (SERIOUS functional bug, auditor A): double-slide on
   `history.back()`.** `nav-pipeline-orchestrator.svelte.ts:576,578`
   use `queueMicrotask(cleanup)` on the back/forward paths. A microtask
   drains before the `popstate` macrotask, so `#navDispatchInFlight` is
   already `false` when the back's `beforeNavigate` re-enters -> the
   orchestrator re-processes -> `navigation.cancel()` -> a SECOND slide.
   The pilot's transition to its back-target (`/messages/inbox`) plays
   the slide TWICE. Verified: sampleCount 56 (vs 24/23 for chip-exits);
   samples show 2-3 slides. The comment says "next macrotask" but the
   code uses microtask (C6). Fix: macrotask (`setTimeout(cleanup, 0)`).
   The existing e2e missed it (asserts `delta>50` + `waitForURL`, not
   replay).
2. **C2/C3 (both): stale `-W/2` comments.** `nav-resolvers.ts:55-59`
   and `NavPipelineHost.svelte:268-270` document `restingTranslate =
-viewportWidth / 2`, but the code uses `-viewportWidth` (corrected in
   Session 2; the comments weren't).
3. **C4 (both): viewport-resize regression.** The orchestrator captures
   `viewportWidth`/`restingTranslate` once at mount; the host's
   `ResizeObserver` updates the host's `$state` but not the
   orchestrator's plan -> on resize the plan desyncs from the inline
   style (track jump + wrong drag-fraction). GPL handled this
   reactively.
4. **C5 (both): missing back-swipe gesture e2e.** The gesture is the
   pipeline's PRIMARY path on the pilot; no e2e drives a touch on
   `/messages/<numeric>`. The full pointer -> pipeline -> goto chain is
   unverified (this is why C1 slipped). The spec's "new spec(s) to
   cover the new pipeline's path" deliverable was not met for the
   gesture path.
5. **C5-B (auditor B): tab-click slide-duration behavior change.** Tab-
   click exit runs ~300ms (`onCommit(0)` -> `T_DEFAULT`) vs GPL's 200ms
   CSS, different easing. Fails the spec's "indistinguishable" bar (the
   e2e checks `delta>50`, not timing).

## What was verified clean

- **UNIFY invariant held:** pilot mounts `NavPipelineHost` (not
  `GesturePageLayout`); no `gestureSource`/`pipelineGestureActive`
  selector; no intent mirror; no `detectSwipe`/CSS-`transition`/
  `transitionend`/`pendingNav` in the pilot's transition path.
  `detectSwipe` reused as a pointer detector only.
- Other routes untouched (GesturePageLayout/MobileTabPager/swipe.ts/
  DualColumnLayout serve them with the full old mechanism).
- The orchestrator coordinates without bypassing SvelteKit (§9); the
  `untrack` cache-seeding fix is correct.
- Gates: check 0/0; lint 0; pilot-touching e2e 33/33; broader sweep
  green (5 `/search` failures are pre-existing, revealed by the untrack
  fix, not introduced by 5b1).

## Note

C1 is the most serious: a user-visible double-slide on the pilot's own
back-target, present in the e2e samples that "passed." My (orchestrator)
coarse "57 green" verification missed it because the tests don't assert
replay. The gesture e2e (C5) + strengthened tab-click assertions would
catch it. This is the e2e gate's value: it forces the primary path to
be exercised, not just the easy assertions.

Consecutive pass votes: **0** (R1 carried six concerns).

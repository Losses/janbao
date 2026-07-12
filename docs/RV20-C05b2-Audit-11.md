# RV20-C05b2 - Audit Round 11 (architect-run, 2 independent auditors, MINIMAL prompt)

Result: **A PASS-WITH-CONCERNS (1 MED + 1 CONCERN); B PASS-WITH-CONCERNS
(3 LOW).** Counter stays 0/5.

R11 used the MINIMAL prompt (spec + Plan + "find any defect" + forbidden + output;
no scope framing). Both independently verified the core pipeline sound.

## R11 findings

- **A #1 (MED) - `#dispatchNav` hardcodes `replaceState: false`, discarding the
  original nav's replaceState intent.** Real: on a deep-link back-arrow tap,
  Header.onBack fires `goto(target, { replaceState: true })`; the orchestrator
  intercepts, cancels, plays the slide, then re-dispatches with
  `replaceState: false` → history pollution (the left page stays in history;
  OS-back lands on it). SvelteKit's `beforeNavigate` does not expose the goto's
  replaceState option, so the orchestrator cannot recover it from the event.
  **Fix path:** a side-channel signal (the caller sets a replaceState flag before
  goto; the orchestrator reads it in `#dispatchNav`). Carried to the next fix
  round.
- **A #2 (CONCERN) - stale "pilot" terminology in FAB layer comments.**
  `pilotTransitionListKind` and the comments describe a "pilot detail-page
  transition" but 5b2 generalizes it to every pipeline route. Comment fix.
- **B C1 (LOW) - skeleton branches unreachable (spec-code drift).** The spec's
  5b1-skipped item #3 says "become reachable" but Promise.allSettled returns
  truthy EMPTY\_\* → the `{:else}` skeleton branches never render. Carried from 5b1
  Known #1.
- **B C2 (LOW) - backParent consumer dissolution timeline (spec-code drift).**
  The spec says "both consumers gone at end of 5b2" but
  `isPipelineSwipeDisabledRoute` is still live (5b3). Spec over-optimistic.
- **B C3 (LOW) - `updateFromPathname` lacks the in-flight guard its sibling
  `updateBackTarget` has.** Latent risk (single caller, externally gated today).

## R10 carried items (not yet addressed)

- A #2 (MED-HIGH): Header CSS transitions + setTimeout (§5 deviation,
  pre-existing). Needs Known condition.
- A #3 (MED): `playEnterAnimation` comment. Comment fix.
- A #4 (LOW): Header reduced-motion not gated. Needs Known documentation.
- B #1 (LOW): NavPipelineHost `left` prop dead code.

## Gate outputs

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e -- ...    93 passed, 1 flake (R10; passes alone)
```

Consecutive pass votes: **0/5**. R12 audits the post-fix state.

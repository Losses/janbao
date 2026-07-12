# RV20-C05b2 - Audit Round 14 (architect-run, 2 independent auditors, MINIMAL prompt)

Result: **A PASS-WITH-CONCERNS (1 MED); B PASS-WITH-CONCERNS (1 MED + 2
LOW/CONCERN).** Counter stays **0/5** (both PWC; no clean PASS). The MED findings
are addressed: A #1 was a real gap in the R13 fix (fixed); B #1 is spec-compliant
per §6 (documented). Gate re-run after the fix.

R14 used the MINIMAL prompt (spec + Plan + "find any defect" + forbidden-reads +
output format; no scope framing).

## A findings

### A #1 (MED) - `#landAtRest` did not clear `replaceStateIntent` (a real gap in the R13 fix)

R13 cleared `replaceStateIntent` in `onSvelteKitAfterNavigate` (every navigation
landing). A cancel-after-regrab returns to rest WITHOUT a navigation landing: the
user taps the back-arrow (the orchestrator consumes the nav and starts the slide,
but does not read the intent until `#dispatchNav`), then mid-slide re-grabs and
releases below the commit threshold. The cancel branch runs `#landAtRest`
directly; no `goto` is dispatched and `afterNavigate` never fires, so the
R13 clear does not run. The intent leaks to the next consumed dispatch, which
then wrongly `goto(target, { replaceState: true })`.

**FIX:** `#landAtRest` now clears `replaceStateIntent` (it runs on both a normal
landing AND a cancel), and `unmount()` clears it too (route-swap displacement +
mobile->desktop flip). Combined with the R13 `onSvelteKitAfterNavigate` clear and
the R12 `#dispatchNav` `.finally` clear, the intent is now cleared on every
path that ends a back-cycle: consumed dispatch, non-consumed landing, cancel, and
host teardown. Defense-in-depth per the project's preference.

**Coverage:** the `replaceStateIntent` lifecycle has no dedicated unit/e2e (the
orchestrator is `.svelte.ts`, not unit-testable under `bun:test`; a deterministic
e2e needs a mid-slide re-grab + cancel, which is intricate timing). Correctness
is verified by code inspection of the four clear sites covering every cycle end.

## B findings

### B #1 (MED) - deep-link back-swipe pushes the back-target onto history

On a deep-link (full page load of `/discussion/...`, `/bookmarks`, etc.) the
synthetic navStore stack seeds the tab root as the back-target, but the real
browser history has no previous entry, so `hopForHref` returns `'push'` and a
back-swipe commit dispatches `goto(target, { replaceState: false })` (pushing the
target). `Header.onBack` mirrors the same scenario with `replaceState: true`.

**RESOLUTION:** spec-compliant. §6 states "the hop-vs-push decision is the generic
`hopForHref` check," and for a deep-link `hopForHref` returns `'push'`. The
gesture path carries no caller `replaceState` intent (only `Header.onBack` sets
it, per Known #15), so it uses the default push. The push also preserves the
navigation model the synthetic stack encodes (the back-target sits "behind" the
current entry, so OS-back returning to the deep-linked page is consistent). The
back-arrow's replace is a distinct mechanism (Known #15: preserve the caller's
replaceState intent). No fix; the two mechanisms differ by design.

### B #2 (LOW/CONCERN) - Header morph does not track the slide for thread back-swipes

For a `centerTab` host (thread + compose routes) the orchestrator publishes
`backMorph: null` throughout the gesture, so the Header stays in back-arrow mode
during the slide and the morph to hamburger updates on landing (Effect C). Deep-
page back-swipes (no `centerTab`) publish `backMorph = rawDragFraction` and morph
smoothly end-to-end, so the two trajectories are visibly inconsistent.

**RESOLUTION:** documented intentional behavior. The orchestrator's
`#republishToPager` + `playEnterAnimation` comments record the choice (the
`centerTab` branch's `backMorph: null` drives the Header). The thread back-swipe
Header morph is part of the Header animation layer (Known #12; the title/morph
coupling migrates to the executor's rAF beyond 5b2). Changing it risks the enter
animation, which also depends on the `centerTab` `backMorph: null` publication.
No change this round.

### B #3 (LOW/CONCERN) - `/messages/add/[userId]` missing from Known #4's list

`/messages/add/[userId]` mounts `NavPipelineHost` (via `MessageCompose`) and is
mis-classified by `isPipelineSwipeDisabledRoute` exactly like the four routes
Known #4 lists, but the spec list omitted it. Behavior is mitigated identically
(`getCurrentTabIndex` returns -1, so `DualColumnLayout.swipeDisabled` holds).

**FIX:** added `/messages/add/[userId]` to Known #4's list.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    196 passed, EXIT=0 (8.3m)
```

Consecutive pass votes: **0/5** (both PWC; A #1 fixed, B #1 spec-compliant, B #2
documented, B #3 fixed). R15 audits the post-fix state.

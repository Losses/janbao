# RV20-C05b2 - Audit Round 28

Result: **A PASS-WITH-CONCERNS (7 CONCERN + 1 nitpick); B PASS-WITH-CONCERNS (6
CONCERN + 1 nitpick).** Counter stays **0/5**. No logic bug this round. Thirteen
concerns, all comment / dead-code / test-coverage / one hydration-pattern issue,
plus two `.md` nitpicks (both fixed).

## A's findings

- **F1 (CONCERN, hydration pattern)** - `NavPipelineHost.svelte` seeded `isMobile`
  from `window.matchMedia` at script init on the client but `page.data.isMobile`
  on the server, diverging from the repo pattern (`(tabs)/+layout`,
  `search/+page`) and risking a hydration mismatch. Fixed: `isMobile` now seeds
  from `page.data.isMobile` (SSR and first client render agree) and the existing
  `onMount` sync flips it to `matchMedia`; `shouldEnter` is now a `$derived.by`
  so it re-evaluates after the flip and the forward-enter animation still plays
  off the live viewport.
- **F2 (CONCERN)** - `e2e/fab.spec.ts` header + test docstrings described the FAB
  layer owning its own rAF sampler, DOM `m41` read-back, and family-swap rAF
  (all moved to the orchestrator). Comments rewritten; test bodies untouched.
- **F3 (CONCERN)** - `route-config.test.ts` describe comment said the latent-bug
  set is "four" routes; it is five (omitted `/messages/add/[userId]`). Fixed.
- **F4 (CONCERN)** - `route-config.test.ts` did not assert the classifier verdict
  for `/messages/add/55`. Added `expect(isPipelineSwipeDisabledRoute('/messages/add/55')).toBe(false)`
  (verified `false` against the registry).
- **F5 (CONCERN)** - `app.css` `.scroll-chrome-scrolling { transition: none }`
  suppressed a Header transition R18 removed; the rule and its `class:` binding
  (and the now-unused `scrolling` derived in `Header.svelte`) were dead. Removed.
- **F6 (CONCERN)** - `route-data.test.ts` `backParent` cases omitted
  `/messages/add/55`. Added a case asserting its `backParent` is `undefined`
  (verified), pinning the Known #1 asymmetry.
- **F7 (CONCERN)** - `DualColumnLayout.svelte` comment overstated
  `isPipelineSwipeDisabledRoute` coverage. Rewritten: the five latent-bug routes
  are additionally gated by `swipeBaseline < 0`; a new pipeline route with a
  non-`'active'`/`'none'` pillTarget and no `backParent` would need checking.

## B's findings

- **C1 (CONCERN)** - orchestrator class docstring claimed the executor queries
  the FAB / Header and writes the per-frame visual to them; hosts actually pass
  `fab: null, header: null` and the FAB / Header are reactive readers. Fixed.
- **C2 (CONCERN)** - orchestrator docstring claimed the mobile->desktop flip uses
  the "full `mount` / `unmount` teardown"; `mount()` is unused (the flip uses
  `unmount`, route swaps use `configure` / `releaseInputs`). Fixed.
- **C3 (CONCERN, dead code)** - the `mount()` method on the orchestrator (and the
  matching `mount()` on the page-lifecycle module) had zero production callers.
  Both removed (the active lifecycle is `configure` / `releaseInputs` / `unmount`).
- **C4 (CONCERN)** - `nav-pipeline-pointer.ts` comment claimed a "single-sourced
  `EDGE_DEAD_ZONE`"; the classifier uses a separately-defined
  `DEFAULT_EDGE_DEAD_ZONE` (`nav-intent.ts`). Rewritten to match the
  `gesture-constants.ts` sister comment (same value 40, separately defined,
  change together).
- **C5 (CONCERN)** - `nav-dom-driver-live.ts` docstring said the driver is
  constructed "in `mount()`"; it is constructed lazily in `configure()`. Fixed.
- **C6 (CONCERN)** - the spec's "FAB layer is a reactive reader" docstring
  omitted `pager.trackFractionalIndex` and `pager.transitionTarget`. Added.

## Nitpicks (`.md`, both fixed)

- spec Family B deep route count "19" corrected to "24" (3 standalone +
  `/profile` + 13 sub-routes + `/admin` + 6 sub-routes).
- spec `/profile` "12 sub-routes" corrected to "13".

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    409 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:430,
                                     the pre-existing CDP touch flake)
```

The F1 hydration change (mobile layout now resolves on `onMount` rather than at
first client render) is verified e2e-safe: the enter animation, every mobile
route, and hide-on-scroll all pass unchanged. No behavioral regression.

R29 audits the post-R28-fix state.

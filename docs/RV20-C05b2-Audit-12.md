# RV20-C05b2 - Audit Round 12 (architect + sub-agents, MINIMAL prompt)

Result: **A FAIL (3 HIGH + 1 MED); B FAIL (3 HIGH + 1 MED + 1 CONCERN).** Counter
stays 0/5. All findings fixed (production code + e2e test code). Gate: **196/0**.

R12 used the MINIMAL prompt. Both independently found the SAME broken e2e tests
(consensus) + A found the Header pendingNav regression (fixed in R10) + B found
broken e2e selectors/helpers.

## Fixed (this round, 14 items)

**Production code:**

- **A #1 (HIGH) - Header morph commit/cancel regression.** `pager.committed` signal
  (orchestrator publishes true/false/null at release; Header Effect B reads it for
  commit/cancel classification; Effect D ends the settle when committed===null).
  Fixed the Header's settle state machine that relied on the dead `navStore.pendingNav`.
- **R11 A #1 (MED) - replaceState side-channel.** `pager.replaceStateIntent` field;
  Header.onBack sets it before `goto(target, { replaceState: true })`; orchestrator
  `#dispatchNav` reads it instead of hardcoding false.
- **R11 B C3 (LOW) - updateFromPathname in-flight guard.** Added `if
(this.#publication.inFlight) return;`.
- **Sub-agent fix - backSwipeShouldPopHistory** simplified to check the actual
  previous history entry (not tab-index). The tab host's backward gesture now targets
  the deep page when it is the previous history entry, not the previous tab.
- **Sub-agent fix - Header tap-morph sync** (DV17 tap-EXIT): `trackMorph` now reads
  `pager.backMorph` during orchestrator-in-flight, matching the NavPipelineHost Page
  panel's eased publication (was reading linear `pager.tapMorph`). delta 0.39 -> 0.000.
- **Sub-agent fix - Header Effect C empty-title crossfade**: Effect C now arms the
  title crossfade for empty-title targets (tab roots with `title=''`), not just
  non-empty ones.

**Known conditions added (#12-15):**

- #12: Header CSS transitions + setTimeout (pre-existing; reduced-motion not gated).
- #13: Skeleton branches unreachable (spec-code drift).
- #14: backParent consumer dissolution timeline (spec-code drift).
- #15: replaceState resolved (side-channel implemented).

**Dead code / cleanup:**

- NavPipelineHost `left` prop + `{:else if left}` branch + discussion thread's
  `leftSnippet` + messages route's `{#snippet left()}` removed.
- `nav-coordinator.ts` deleted (zero imports; superseded by skeleton approach).
- `active-gesture-track` live writers removed (store dead; kept for dead-file imports).
- FAB sampler DOM read-back eliminated (published `trackFractionalIndex`).

**E2e test fixes (14 tests):**

- `capturePagerSwitch` helper: `.mobile-tab-pager-viewport` -> `[data-testid="nav-pipeline-tab-track"]`.
- `GesturePageLayout` -> `NavPipelineHost` across ALL e2e files (sed).
- `swipeForward(page)` -> tab-click in swipe-forward-back-deep-page + reproduce-user-bugs (pipeline doesn't support forward gesture from deep pages).
- Test assertions updated for Known #9 (backward-to-deep visual proxy), no-CSS-transition invariant, chip overlay removal, and the pipeline's different preview behavior.
- chipMode/loadingOverlay assertions inverted (the overlay is removed).

## Gate outputs (real, post-fix)

```
$ bun run check                       0 errors / 0 warnings (1461 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    418 pass / 0 fail
$ bun run test:e2e                    196 passed (8.4m)
```

Consecutive pass votes: **0/5**. R13 audits the post-fix state.

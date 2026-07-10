# RV20-C05b1 - Audit Round 44 (architect-run, 2 independent auditors)

Result: **0/2 PASS**. A PASS-WITH-CONCERNS (7); B PASS-WITH-CONCERNS (5).
Both auditors run clean/role-less/hint-less on the post-R43 state; neither
saw prior-round results. The UNIFY invariant, all-rAF executor, and the
R43 chip-exit slide-while-loading design were all confirmed correct. The
concerns are behaviour-preservation edges + comment accuracy.

## Combined concerns (A 1-7 + B 1-5, deduped) + fixes

### Med behaviour (real GPL divergences)

- **B-C1 / desktop-flip mid-transition loses the nav.** A mobile->desktop
  resize during a chip-exit/gesture called `unmount` which zeroed the
  pending nav slots; the settle dispatch never ran. GPL's pendingNav poll
  has an 800ms wall-clock cap that lands the nav regardless of platform.
  FIX: `unmount` dispatches the pending target before clearing (gated on
  `!navDispatchInFlight` so a route-unmount mid-nav does not double-
  dispatch). Affects 2 of 3 transition-start paths (gesture + tab-click
  chip-exit; playEnter has no nav).
- **A-C1 / FAB coverProgress discontinuity when a tab-click interrupts a
  forward-enter.** The tab-click captured `#commitStartRaw` = the enter's
  eased progress, but coverProgress was forced to 0 during the enter ->
  FAB scale jumped 0 -> 0.4 at the interrupt. FIX: capture
  `#commitStartRaw = #isEnterAnimation ? 0 : progress` before clearing
  the flag.
- **A-C2 / `fromPathname` stale on a same-route param change.**
  `/messages/123 -> /messages/456` reuses NavPipelineHost (no remount);
  the orchestrator's captured `fromPathname` went stale and `#isPilotFrom`
  then declined a subsequent tab-exit (GPL reads `page.url.pathname`
  reactively). FIX: `updateFromPathname(pathname)` + a host `$effect`
  keeps it in sync.

### Low comment / architecture / latent / coverage

- **A-C3 / singleton fragility**: `setNavPipelineOrchestrator(null)` on
  an older destroy could orphan a newer active. FIX: added
  `releaseNavPipelineOrchestrator(orch)` (identity-checked); the host's
  destroy/desktop-unmount now passes its own orchestrator.
- **A-C4 / playEnter `#commitStartRaw` captured after the publication
  reset** (inconsistent with the sibling paths). FIX: capture before the
  reset.
- **A-C5 / chip-exit overlay comment overclaimed** ("the chip grows
  0 -> W" - that is the overlay div's width; the atom's scale grows
  1.15 -> 1.6). FIX: clarified overlay-width vs atom-scale.
- **B-C2 / `resetPagerStore` published `active: false`** (GPL's
  centerTab branch publishes `active: true`). Masked for the pilot
  (urlIndex === centerTab). FIX: publish `active: true` (matches GPL,
  removes the latent 5b2 vector).
- **B-C4 / playEnter "matching CSS duration-200"** lacked the easing
  caveat. FIX: added the `s(u)=2u-u²` easing note (Plan §5).
- **B-C5 / `unmount` did not reset every transient field**
  (`#isEnterAnimation`, `#commitStartRaw`, `#prevWasDrag`, `#liveDragging`)
  and the `mount` "idempotent" docstring overclaimed. FIX: `unmount`
  resets all transient fields.
- **A-C6 / tab-click at a forward-enter's first frame ran a 200ms no-op
  slide** (`startProgress` already at the target). FIX: `startCommit`
  short-circuits to an immediate settle when `progress === target`.
- **A-C7 / tab-click-during-forward-enter e2e** asserted only
  `waitForURL`. FIX: added a track-translateX sampler + a no-teleport
  assertion (`maxDelta < 150`) locking the interrupt handoff.
- **B-C3 / cold-cache race** (the coordinator gates on PageCacheStore,
  seeded post-hydration, vs GPL's synchronous `data.*`). Not user-
  reachable (a drag cannot start in the first frame); documented at the
  coordinator call site.

## Gate outputs (real, post-fix)

```
$ bun run check          0 errors / 0 warnings (1458 files)
$ bun run lint           EXIT=0
$ bun test src/lib/utils src/lib/stores    436 pass / 0 fail
$ bun run test:e2e -- 8-spec pilot sweep    80 passed
```

Consecutive pass votes: **0** (R44 carried concerns; all fixed; R45 audits
post-fix).

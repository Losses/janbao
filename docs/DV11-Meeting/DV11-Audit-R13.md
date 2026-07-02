# DV11 - Audit Round 13

5 independent role-less auditors examined `docs/DV11-Plan.md` (v13) under a clean open-ended prompt. Result: **not 5/5 PASS.** 3 PASS (auditors 1, 2, 3) / 2 FAIL (auditors 4, 5), each FAIL with a BLOCKING. Both blockers are consequences of ONE root design choice: reusing the `.detail-scroll-pane` marker on the pager's active panel.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | PASS    | 0        | 2     | 4     | has-special-cases |
| 2       | PASS    | 0        | 0     | 3     | clean             |
| 3       | PASS    | 0        | 0     | 3     | clean             |
| 4       | FAIL    | 1        | 2     | 3     | has-special-cases |
| 5       | FAIL    | 1        | 3     | 3     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## The two blockers (one root cause: `.detail-scroll-pane` reuse)

### B1 - `captureEnterAnimation` latches onto the pager track on `/` (auditor 4, BLOCKING)

`helpers.ts:250-306` `captureEnterAnimation.findTrack()` = `document.querySelector('.detail-scroll-pane')?.parentElement`, and the sampler locks `track` ONCE with NO `isConnected` guard. Under v13 the pager's active panel carries `.detail-scroll-pane` on every tab route, so on `/` `findTrack()` returns the PAGER track. `enter-animation.spec.ts:31` installs the sampler while on `/`, the first rAF latches the pager track, then `clickDiscussion` navigates to `/discussion/*` (a top-level route, not under `(tabs)`) which unmounts the pager → the locked track is detached → `getComputedStyle(detachedTrack).transform` is stale → `delta ≈ 0` → `animated = false`. CALIBRATION + both regressions fail. v13 §6.6 lists `enter-animation` under "remain green" - false. (The analogous `captureExitPreview` collision was flagged for `tab-exit-preview` in v13 §6.6; `captureEnterAnimation` is the same class, missed.)

### B2 - root-layout `beforeNavigate` capture clobbers the per-panel key during a tab swipe (auditor 5, BLOCKING)

`+layout.svelte:65` captures `pageScrollStore.capture(from.url.pathname, getCurrentScrollY())` on every nav; `getCurrentScrollY()` (`page-scroll.svelte.ts:23-32`) reads `.detail-scroll-pane`. In `switchTo` (`:190-201`) `activeIndex` flips synchronously (the `.detail-scroll-pane` class moves to the NEW panel) BEFORE the async `goto`; by the time `beforeNavigate` fires, `getCurrentScrollY()` reads the NEWLY-active neighbour's scrollTop (0), overwriting the SOURCE panel's `onscroll`-captured value under the source's key. The §6.2 "switch away and back → restored" assertion then fails (restore reads 0). v13's §4 rationale argues only that the _keys_ agree, never the _values_.

## Root cause and the v14 simplification

Both blockers (and the earlier `captureExitPreview` collision, the `.detail-scroll-pane` first-match-during-swap concern, the discussion-page collision) are consequences of ONE choice: making the pager's active panel carry `.detail-scroll-pane` so `getCurrentScrollY()` reads it. But that marker is ALSO the selector GPL-side consumers (the e2e samplers, the root capture, the discussion page) use to find the GPL centre - so reusing it collides everywhere.

**v14 removes the reuse entirely:**

- The pager's active panel is just `.scroll-pane[data-preview-tab]` (the flat-white surface) - it does NOT carry `.detail-scroll-pane`. (`hide-on-scroll` uses `setScrollContainer` directly, which does not need the marker.)
- The root-layout `beforeNavigate` capture (`+layout.svelte:65`) is GATED on `!isPagerRoute(from.url.pathname)` - skipped for the three tab roots, because the pager's per-panel `onscroll` is the sole writer for those keys. The cross-route `/`↔`/discussion` restore still works: the pager's `onscroll` wrote `pageScrollStore['/']`; GPL's left preview reads it.
- `getCurrentScrollY()` is then never called on a tab route (only on deep routes where the pager is unmounted), so it never needs a pager panel to carry `.detail-scroll-pane`.

This eliminates, by construction: the `captureEnterAnimation` collision (B1), the `captureExitPreview` collision (v13 §6.6), the root-capture clobber (B2), the `.detail-scroll-pane` first-match ambiguity during the swap, and the discussion-page collision. The §6.4(b) / §6.3 tests scroll the active panel via its `data-tab-panel` attribute (kept), not `.detail-scroll-pane`.

## Verified-TRUE facts carried forward (Round 13 additions)

- `captureEnterAnimation` (`helpers.ts:250-306`) locks `track` once with no `isConnected` guard; `tab-click-transition.spec.ts:64` HAS the guard (that spec is safe). Under v13 the pager's `.detail-scroll-pane` makes `findTrack()` latch the pager track on `/`.
- `+layout.svelte:65` root capture writes `getCurrentScrollY()` (`.detail-scroll-pane`) under `from.url.pathname` on every nav; `switchTo` flips `activeIndex` (and the class) sync before async `goto` → the capture reads the new panel and clobbers the source key.
- The pager does NOT need `.detail-scroll-pane`: its `onscroll` captures per-panel; `hide-on-scroll` uses `setScrollContainer` directly; `getCurrentScrollY` is only needed for the root capture, which can be skipped for pager routes.
- All prior endorsed facts hold: the architecture, refcount + `held`-guard + clamp, `releaseContainer` self-heal, `setOverride` never contends, `list-scroll.svelte.ts` dead, `data-preview-tab` surface pre-provided, restore sync-first-then-rAF, §6.4(a) empirical arbitration, `/`↔`/discussions/pN` NEW boundary, per-panel `MOBILE_TABS[N].href` keying (no `switchTo` lag).

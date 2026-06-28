# DV08 - Audit Round 3

Workflow `wf_3a783caf-334`. 5 independent role-less auditors. Result: **2/5 PASS** (auditors 1 & 4 PASS, clean organic; all 5 organic=clean). B1 (multi-move exclusive) and B4 (leftward underline) confirmed FIXED by all. Remaining FAILs converge on two scroll/cache issues.

## Tally

| Auditor | Verdict | Blocking | Concerns | Organic | Confidence |
| ------- | ------- | -------- | -------- | ------- | ---------- |
| 1       | PASS    | 0        | 6        | clean   | high       |
| 2       | FAIL    | 1        | 6        | clean   | high       |
| 3       | FAIL    | 2        | 5        | clean   | high       |
| 4       | PASS    | 0        | 4        | clean   | high       |
| 5       | FAIL    | 1        | 5        | clean   | high       |

## Blocking issues (deduplicated)

**Blocker X - active-panel `setScrollContainer` does not reliably override `centerEl` (HIGH, 2 & 5).** Svelte 5 parent/child `$effect` order is not guaranteed (the repo's `html-data-theme-single-owner` memory documents this exact race). On `/search` mount, if `GesturePageLayout`'s `centerEl` effect runs after `SearchScopePager`'s active-panel effect, `centerEl` wins (last-writer) and is inert (its child fills it exactly) → hide-on-scroll dead for the session. The "last-writer-wins, no-null-on-cleanup" reasoning does not guarantee the inner wins on mount.

**Blocker Y - `.gpl-card` height-chain gap (HIGH, 3).** `.gpl-card` has only padding (no height); the chain `html.fixed-viewport → centerEl(h-full) → .gpl-card(auto) → viewport(height:100% of auto) → panel(auto)` breaks → panel `height:100%` resolves to content height → `overflow-y:auto` never triggers → `centerEl` becomes the scroller. `MobileTabPager` avoids this via ResizeObserver-to-active-panel-height (not a height:100% chain).

**Blocker Z - `search-cache` has no q-change invalidation (HIGH, 3).** Keyed by scope only → swiping back to a visited scope after a new `q` serves stale (old-`q`) results. Cache key must be `(scope, q, sort)`; `q`/`sort` change invalidates.

## Notable concerns (non-blocking; mostly auditor 1 who PASSED)

- Active scope panel must carry `.scroll-pane` (header-overlay `padding-top: var(--header-height)`).
- Active-panel `$effect` must be the single registrant (not per-panel).
- `search-cache` snapshot timing (populate each scope's data when it is active - append-only, no overwrite race).
- Scope-panel scroll restoration when fresh data arrives (per-panel scroller preserves `scrollTop` across remounts; may reset on data change).
- `VisualViewport` `--avail-height` keyboard mitigation is must-verify.

## Verified-FIXED (carry forward)

B1 (exclusive shields every claimed move; ancestor never sees a move during an inward drag → no `setPointerCapture` race, no capture-transfer, no strand; `pointerup` still bubbles to reset the ancestor). B4 (leftward `hi=(a+1)*c - max(0,(t-L)/(1-L))*c`; `width>=c` everywhere, `width>c` for `t∈(0,1)` both directions). B2/B3/B5/B6(partial)/B7 from earlier rounds. `organicIntegration` now `clean` for all 5 under the reframed criterion.

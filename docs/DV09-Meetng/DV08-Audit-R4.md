# DV08 - Audit Round 4 (FINAL)

Workflow `wf_2732a3ae-4e1`. 5 independent role-less auditors. Result: **5/5 PASS** (all unconditional, all organic=clean, high confidence). Loop exit condition met.

## Tally

| Auditor | Verdict | Blocking | Concerns | Organic | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | PASS | 0 | 3 | clean | high |
| 2 | PASS | 0 | 3 | clean | high |
| 3 | PASS | 0 | 3 | clean | high |
| 4 | PASS | 0 | 2 | clean | high |
| 5 | PASS | 0 | 3 | clean | high |

## Verified-FIXED (all three round-3 blockers, against source)

- **X (effect ordering).** `scroll-chrome` gains a reactive `override` (+ `setOverride`), mirroring the `page-theme` single-owner pattern. `GesturePageLayout`'s `centerEl` `$effect` is the sole `setScrollContainer` caller, registering `scrollChrome.override ?? centerEl` - a pure function of two reactive reads, so the result is independent of which `$effect` flushes first; it re-runs when `override` changes. `SearchScopePager` sets the override to the active panel; children-first teardown clears the override before `GesturePageLayout`'s null cleanup (transient centerEl re-registration harmless). No race.
- **Y (height chain).** `app.css` rule `html.fixed-viewport .gpl-card:has([data-search-scope-pager]) { height:100% }` (the `:has()` pattern is established at `app.css:317`) gives the pager card a definite height only when it contains the pager. Each scope panel `height:100%; overflow-y:auto` + class `scroll-pane` (header `padding-top`). `overflow:clip` on the viewport avoids the programmatic-scroll lock. No collateral on other deep pages (scoped by `:has()`).
- **Z (cache keying).** `search-cache` keyed by `(scope, q, sort)`, entry stores its source `(q, sort)`, miss-on-mismatch; append-only populate-when-active avoids the overwrite race; `q`/`sort` change evicts stale entries.

## Confirmed-still-holding

- **B1** - `exclusive` calls `stopImmediatePropagation` on the claim move AND every steady-state swipe move (the ancestor never sees a move → never claims → no `c05594c` race, no capture transfer, no strand); `pointerup` is not stop-prop'd, bubbles, resets the ancestor.
- **B4** - leftward `lo=(a-t)*c`, `hi=(a+1)*c − lag*c`; `width>c` for `t∈(0,1)`, `width===c` at integers.

## Organic integration - CLEAN (all 5)

`grep` confirms `swipe.ts`, `GesturePageLayout.svelte`, `navigation-logic.ts`, `navigation.svelte.ts`, `tab-config.ts`, `scroll-chrome.svelte.ts` contain **zero** `/search`/`scope` feature tokens (only pre-existing URL `.search` string fields). The plan adds only general capabilities: `shouldClaim`/`exclusive` on `detectSwipe`; the `backMorph` mechanical rename; the `scroll-chrome` override. New files mirror existing patterns (`header-mode.ts`↔`deep-header-config`; `SearchScopePager`/`SearchTabBar`↔`MobileTabPager`/`MobileTabBar`; `search-cache`↔`list-cache`).

## Non-blocking concerns (carried to implementation, not re-audited)

- `search-cache` orphaned-entry growth over a long session - add a cap or clear-on-unmount.
- §6.11 overstates the FTS body-hit as "unbounded" - the LIKE fallback is capped (`LIKE_FALLBACK_LIMIT=200`) and the FTS path paginates returned rows (the underlying MATCH scan may still be large); the statement is conservative, corrected in the plan.
- `VisualViewport` keyboard mitigation is must-verify-on-device (no-autofocus fallback documented).
- Multi-touch with two `detectSwipe` instances + `exclusive` is test-gated, not analytically proven for all orderings.

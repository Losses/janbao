# DV08 - Audit Round 2

Workflow `wf_dfc3f120-183`. 5 independent role-less auditors. Result: **0/5 PASS** (all FAIL, high confidence). Round-1 B2/B3/B5/B7 verified FIXED; B1/B4 persisted (narrow, technical); B6 partly fixed.

## Tally

| Auditor | Verdict | Blocking | Concerns | Organic           | Confidence |
| ------- | ------- | -------- | -------- | ----------------- | ---------- |
| 1       | FAIL    | 2        | 7        | has-special-cases | high       |
| 2       | FAIL    | 3        | 7        | has-special-cases | high       |
| 3       | FAIL    | 2        | 6        | has-special-cases | high       |
| 4       | FAIL    | 2        | 7        | has-special-cases | high       |
| 5       | FAIL    | 2        | 7        | clean             | high       |

## Blocking issues (deduplicated)

**B1-residual - `exclusive`/`stopImmediatePropagation` only shields the claim move; ancestor re-races on moves 2..N (CRITICAL, 5/5).** `stopImmediatePropagation` is per-event. The plan specified it only at the deciding→swipe claim; the steady-state swipe move path (`swipe.ts:428-430`) has none. On move #2+, the bubbled move reaches the ancestor (still `deciding`, `primaryPointerId===p`), the ancestor claims and calls `setPointerCapture` → per spec **transfers capture away from the inner mid-drag** → inner strands at `swipe` forever (no `pointerup` reaches the descendant). Strictly worse than `c05594c`. Fix: apply `stopImmediatePropagation` on every pointermove the action claims (claim move + all `phase==='swipe'` moves), NOT on yield (`shouldClaim===false`) and NOT on `pointerup`/`pointercancel`.

**B4-residual - leftward underline anchors trailing edge at source-left, not source-right (CRITICAL/HIGH, 5/5).** For `dir<0`, `trail(cell)=cell*c - …` anchors at the source left edge; at t=0.5 width collapses to 0.5c (clamped to c) - leftward never stretches. The `width>=c` unit test passes vacuously (clamp forces it). Fix: `dir<0` → `lo=(a-t)*c`, `hi=(a+1)*c - max(0,(t-L)/(1-L))*c`. Add edge-position assertions + `width>c` for `t∈(0,1)`.

**B6-residual - viewport `overflow:clip` incompatible with "panels scroll inside centerEl" (HIGH, 2/5).** `overflow:clip` clips both axes; clipped content never overflows `centerEl` → hide-on-scroll inert. The `overflow-x:clip; overflow-y:visible` combination computes `visible→auto` (CSS spec), making the viewport itself the scroller. Fix: viewport `overflow:clip` + `height:100%`; each scope panel `height:100%; overflow-y:auto` (own scroller); the **active** panel registers `setScrollContainer` (overrides `centerEl`).

## Notable concerns (non-blocking)

- `dragDir` has no field in `PagerUpdate` (4.7 sketch omits it) - derive in `SearchTabBar` from `fractionalIndex` delta instead.
- Eager 4-scope FTS cost ×4/keystroke; `discussionsFtsHits`/body-hit unbounded (only LIKE fallback caps at 200). Drop eager-4 → active-scope-only + `search-cache`.
- `?page=` reset on scope switch unspecified.
- Stale line-number citations (drift).
- Autofocus + `html.fixed-viewport` keyboard interaction only test-gated.
- `scrollChrome.show()` suppressed during inward drags (ancestor's `onMove` shielded) → `SearchScopePager` must call it itself.
- `organicIntegration`: 4/5 `has-special-cases` - `shouldClaim`/`exclusive` have one consumer; `resolveHeaderMode` hardcodes `/search`; Header imports `SearchTabBar`. (Reframe: these are feature files following existing patterns; shared primitives are clean.)

## Verified-FIXED (carry forward)

B2 (closure-scoped `$state`), B3 ((mode, backMorph) layer table; `searchLayer` visible at rest on `/search`; SSR via `?? (mode==='root'?1:0)`), B5 (swipe.ts two general params; GesturePageLayout rename-only, `0`/`null` contract preserved), B7 (keep `?page=` for active scope).

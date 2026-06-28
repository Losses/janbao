# DV08 - Audit Journal

Append-only log of the 5-agent role-less full-audit loop. Each round: 5 independent auditors examine `docs/DV08-Plan.md` against the real codebase; loop until 5/5 unconditional PASS.

## Round 1 - 0/5 PASS → revised

Convergent blockers: (B1 CRITICAL) boundary handoff impossible with unmodified `detectSwipe` - `c05594c` race; (B2) factory `$state` module-scoped; (B3) header at-rest layer wrong (`deepMorph:0` at rest on `/search`); (B4) underline math contracted width→0; (B5) "zero modification" framing false; (B6) `setScrollContainer` double-registration; (B7) dropping `?page=` regressed shareability. Full detail: `DV08-Audit-R1.md`.

Revision decisions: handoff via two general `detectSwipe` params (`shouldClaim`, `exclusive`) + pointer-flow trace; closure-scoped `$state` factory; explicit (mode, backMorph) layer table; corrected underline leading edge; scrollChrome option b; keep `?page=`; honest gates.

## Round 2 - 0/5 PASS → revised

`DV08-Audit-R2.md`. B2/B3/B5/B7 verified FIXED. B6 partly fixed. Two blockers persisted and are narrow + technical:

- **B1-residual (CRITICAL, 5/5).** `event.stopImmediatePropagation()` is per-event, not a persistent shield. The plan specified it only at the deciding→swipe claim moment; the steady-state swipe move path (`swipe.ts:428-430`) has none. So move #2+ bubbles to the ancestor (still `deciding`, `primaryPointerId===p`), the ancestor claims and calls `setPointerCapture` → per spec **transfers capture away from the inner mid-drag** → the inner strands at `swipe` forever (no `pointerup` reaches it). Worse than `c05594c`.
- **B4-residual (CRITICAL/HIGH, 5/5).** Leftward `trail(cell)=cell*c - …` anchors the trailing edge at the source **left** edge; should be source **right** `(cell+1)*c`. At t=0.5 the code yields width 0.5c (clamped to c), not 1.5c - leftward never stretches. The `width>=c` unit test would pass vacuously (clamp forces it).
- **B6-residual (HIGH, 2/5).** Viewport `overflow:clip` (clips both axes) is incompatible with "scope panels scroll inside `centerEl`" (clipped content never overflows `centerEl` → hide-on-scroll inert).

Secondary: `dragDir` had no home in `PagerUpdate` (4.7 sketch omitted it); eager 4-scope FTS is unbounded ×4/keystroke; `?page=` reset on scope switch unspecified; stale line-number citations; autofocus+`html.fixed-viewport` only test-gated.

### Revision decisions for Round 3

- **B1 fix:** `exclusive` calls `event.stopImmediatePropagation()` on **every pointermove the action claims** (the claim move AND every move while `phase==='swipe'`, added to the steady-state path), NOT when it yields (`shouldClaim===false`) and NOT on `pointerup`/`pointercancel` (ancestor resets via the bubbled up). Full multi-move trace re-stated. `SearchScopePager` calls `scrollChrome.show()` in its own `onMove` (the ancestor's is suppressed).
- **B4 fix:** `dir<0`: `lo=(a-t)*c`, `hi=(a+1)*c - max(0,(t-L)/(1-L))*c` (source-right origin). Unit test asserts edge positions + `width>c` for `t∈(0,1)` on both directions, not just `width>=c`.
- **B6 fix:** viewport `overflow:clip` + `height:100%`; each scope panel `height:100%; overflow-y:auto` (own scroller); the **active** panel registers `setScrollContainer` (overrides `centerEl`, last-writer-wins; no `null` on cleanup); `GesturePageLayout` cleanup reverts to window on unmount.
- **dragDir:** derived in `SearchTabBar` from the `fractionalIndex` delta - no store field, no `PagerUpdate` change.
- **Data loading:** drop eager-4. Load the **active** scope only (as today) + a `search-cache` store (sibling of `list-cache`) for visited scopes. Per-keystroke cost 1× (not 4×); scope switch sets `?scope=X&page=1`.
- **Citations:** non-positional (describe sites semantically; line numbers drift).
- **Autofocus:** input in the sticky header (outside the locked flow); scope panels use `VisualViewport`-driven available-height CSS var so the active panel scrolls under the keyboard; must-verify on device, fall back to no-autofocus if unstable.
- **organicIntegration definition (audit prompt):** "clean" = no `/search`/`scope` tokens or feature branches in the mandated shared primitives (`swipe.ts`, `GesturePageLayout.svelte`, `navigation-logic.ts`, `navigation.svelte.ts`, `tab-config.ts`) AND the new code follows existing patterns (mode resolver mirrors `deep-header-config`; siblings mirror `MobileTabBar`/`MobileTabPager`; factory store; general `detectSwipe` params reusable by any nested pager). Feature-specific files existing is expected and clean if they extend a pattern; `has-special-cases` only if a shared primitive has a `/search` branch or new code reinvents instead of extending.

## Round 3 - 2/5 PASS → revised

`DV08-Audit-R3.md`. B1 (multi-move `exclusive`) and B4 (leftward underline) confirmed FIXED by all five. `organicIntegration` now `clean` for all 5 under the reframed criterion. Two PASS (auditors 1, 4). Three FAILs converged on:

- **Blocker X - `setScrollContainer` effect-ordering race (HIGH).** Svelte 5 parent/child `$effect` order is not guaranteed; two effects calling `setScrollContainer` race on mount (`html-data-theme-single-owner` lesson).
- **Blocker Y - `.gpl-card` height-chain gap (HIGH).** `.gpl-card` has no height → panel `height:100%` resolves to content height → `overflow-y:auto` never triggers.
- **Blocker Z - `search-cache` no q-change invalidation (HIGH).** Keyed by scope only → stale (old-`q`) results served.

Revision: single-owner scroll-container via a `scroll-chrome` `override` (GesturePageLayout's `centerEl` effect is the sole `setScrollContainer` caller, registering `override ?? centerEl`); targeted `app.css` `.gpl-card:has([data-search-scope-pager]) { height:100% }` + panel `.scroll-pane`; `search-cache` keyed `(scope, q, sort)`.

## Round 4 - 5/5 PASS (FINAL, unconditional)

`DV08-Audit-R4.md`. All three round-3 blockers verified FIXED against source. B1/B4 confirmed still holding. `organicIntegration` `clean` for all 5 (grep confirms zero `/search`/`scope` tokens in the shared primitives). **Loop exit condition (5/5 unconditional PASS) met.** Plan is final and ready for implementation. Non-blocking notes carried forward: `search-cache` orphan-cap; FTS-cost test-gate; keyboard device-verify; multi-touch test-gate.

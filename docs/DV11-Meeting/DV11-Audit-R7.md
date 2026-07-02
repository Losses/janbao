# DV11 - Audit Round 7

5 independent role-less auditors examined `docs/DV11-Plan.md` (v7, unify onto the scroll-pane abstraction) under a clean open-ended prompt. Result: **not 5/5 PASS**. 5/5 FAIL, all high confidence. For the first time the panel unanimously **endorses the architecture**: the unification onto the single `fixed-viewport` + `.scroll-pane` + `pageScrollStore` + `setScrollContainer` height/scroll model is correct, and no second height mechanism survives (`panelHeights`/`neighborOffset`/`viewportHeight` all deleted). The failures are concrete edits and one coordination-design gap - the plan over-promised "one abstraction, no special-casing" when the implementation genuinely needs a shared-ownership design for two global singletons.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | FAIL    | 1        | 4     | 4     | has-special-cases |
| 2       | FAIL    | 2        | 4     | 4     | has-special-cases |
| 3       | FAIL    | 2        | 4     | 3     | has-special-cases |
| 4       | FAIL    | 1        | 3     | 4     | has-special-cases |
| 5       | FAIL    | 1        | 2     | 4     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## Convergent findings

### `.gpl-card` is wrong for the tab panels (BLOCKING, auditors 1, 4, 5)

v7 §4 wraps each tab panel's content in a `.gpl-card`. But GPL's own tab-root previews render the panel with NO `.gpl-card` (`GesturePageLayout.svelte:967-975`); `.gpl-card` is only for non-tab-root deep previews (`:978-986`) and the centre panel (`:995`). `app.css:333-341` already gives `.scroll-pane[data-preview-tab="discussions|activity|messages"]` the flat-white `base-100` surface + `padding-top: calc(header+0.75rem)` + gutters. Adding `.gpl-card` double-pads (the card's own `0.75rem`, `app.css:239-241`) and adds an unconditional `border-bottom` (`app.css:342-345`) - a visible regression from today's borderless flat-white tabs. Fix: tab panels are `.scroll-pane[data-preview-tab=<key>]` with NO `.gpl-card` child.

### Two owners of `html.fixed-viewport` and `scrollChrome` container, no coordination design (BLOCKING, auditors 2, 3, 4, 5)

Today only GPL owns `html.fixed-viewport` (`GesturePageLayout.svelte:866/877/911`) and the scroll-chrome container (`:325-334`, documented single-owner). v7 makes the pager a second owner of both. `/discussion/*` is NOT under `(tabs)` (separate top-level route), so a `/`↔`/discussion` SPA swap unmounts the whole `(tabs)` layout (pager) and mounts the discussion page (GPL) - both touch the same globals, and Svelte 5 does not guarantee mount-before-destroy ordering across the swap. The plan's "use a guard (refcount or querySelector)" is an unresolved either/or (forbidden) on the single highest-blast-radius runtime question. A `querySelector` check is insufficient (both legitimately want the class); a refcount is needed but unspecified.

### Concrete edits (MAJOR, convergent)

- **Viewport missing `position: relative`** (auditors 1, 4): the deep-preview overlay (`absolute`) needs a positioned ancestor; GPL's viewport sets `position: relative` (`GesturePageLayout.svelte:486`). v7 references a "now-position:relative viewport" but never adds it.
- **`measureViewportWidth`/`viewportWidth` must survive** (auditor 5): it feeds the MobileTabBar indicator (`fractionalIndex`). v7's delete list didn't enumerate keeping it; only `neighborOffset`/`resetViewportScroll`/the window-scroll listener should be stripped.
- **`listScroll` is dead - state it, don't hedge** (auditors 2, 3, 4): `listScroll.captured` round-trips through the thread page's snapshot (`discussion/.../+page.svelte:53,62,70`) but is NEVER applied to any DOM element; GPL's left-preview reads `pageScrollStore.get('/')` (`:224`), a different store. v7's "verify and remove if dead" is a hedge.
- **`data-tab-panel`→`data-preview-tab` rename breaks sibling specs** (auditor 3): `tab-data-root-load.spec.ts`, `swipe-forward-back-deep-page.spec.ts`, `reproduce-swipe-back-preview-bug.spec.ts` query `[data-tab-panel]`. Keep both markers.
- **Semantic overload of `data-preview-tab`** (auditor 3): `app.css:166` `.appbar-title [data-preview-tab] .page-title { display:block }` would now match the pager's panels; verify no `.page-title` in tab panels or accept it.
- **`(tabs)` snapshot restore on mobile** (auditors 1, 4): `swipe-forward-back-deep-page.spec.ts` asserts a `window.scrollY` snapshot restore of `/`; under `fixed-viewport` this is a per-panel `pageScrollStore` restore with different (rAF-deferred) timing - the no-top-flash guarantee must be re-asserted, not assumed.

## Verified-TRUE facts carried forward (Round 7 additions)

- The unification thesis holds for height/scroll: after the deletions the pager's only height mechanism is `fixed-viewport` + screen-height viewport + `.scroll-pane`/`.detail-scroll-pane` panels, matching GPL. The spatial-track mechanism (`dragOffset`/`activeIndex`/`viewportWidth`/deep-preview overlay/back-chip) is legitimately pager-specific.
- `app.css:333-341` matches `data-preview-tab="discussions|activity|messages"` and overrides `.scroll-pane`'s base-200 to base-100 for those three - so flat-white tabs are preserved by the data-preview-tab rule alone, no `.gpl-card`.
- The active/centre panel carries BOTH `.scroll-pane` and `.detail-scroll-pane` in GPL (`:992`); specificity of `data-preview-tab` (0,2,0) beats `.detail-scroll-pane` (0,1,0), so the active tab panel's flat-white treatment holds when it carries both classes.
- `listScroll.consume()` is never called; `listScrollTop` is dead state (snapshot plumbing only).
- `/discussion/*` is a sibling top-level route, NOT under `(tabs)` - the swap unmounts `(tabs)` (pager) and mounts `/discussion` (GPL), so both touch `html.fixed-viewport`/`scrollChrome` during the transition. `swipe-forward-back-deep-page.spec.ts:467-475` documents the pager remounts on every list↔thread transition.
- `setOverride` (SearchScopePager, nested under GPL) vs `setScrollContainer` (GPL centre / pager, top-level) is the correct API split - `GesturePageLayout.svelte:331` reads `override ?? centerEl`.
- `getCurrentScrollY` (`page-scroll.svelte.ts:27`) first-match `.detail-scroll-pane` is unambiguous at steady state and in `beforeNavigate` (source still mounted); the residual risk is order-dependent `afterNavigate` reads during co-mount (narrow).
- `MOBILE_TABS[i].labelKey` is exactly `discussions|activity|messages` (`mobile-tabs.ts`), matching the app.css selectors.
- Desktop is unaffected (`(tabs)` renders `children`; the pager and its `fixed-viewport` onMount are mobile-only).

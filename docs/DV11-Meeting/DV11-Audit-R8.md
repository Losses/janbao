# DV11 - Audit Round 8

5 independent role-less auditors examined `docs/DV11-Plan.md` (v8, unification + shared ownership layer) under a clean open-ended prompt. Result: **not 5/5 PASS**. 1 PASS / 4 FAIL, all high confidence. The closest round: the architecture AND the shared-ownership layer are endorsed (auditor 1 PASS, 0 blocking). The failures are two specific mechanism gaps plus concrete-edit corrections.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic           |
| ------- | ------- | -------- | ----- | ----- | ----------------- |
| 1       | PASS    | 0        | 3     | 3     | has-special-cases |
| 2       | FAIL    | 2        | 2     | 4     | has-special-cases |
| 3       | FAIL    | 1        | 2     | 4     | has-special-cases |
| 4       | FAIL    | 2        | 3     | 3     | has-special-cases |
| 5       | FAIL    | 1        | 2     | 3     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## Convergent findings

### The refcount must handle GPL's resize-toggle, not just mount/destroy (BLOCKING, auditors 3, 5)

GPL adds/removes `html.fixed-viewport` inside `sync()` on every `mq` change (`GesturePageLayout.svelte:866/877`), because GPL stays mounted across mobile↔desktop resize (it flips `isMobile`, not unmount). v8's acquire/release-on-mount/destroy cannot reproduce that: a desktop GPL mount would `release()` without a prior `acquire()` → counter underflows → the class never re-adds → the entire `fixed-viewport` CSS layer (which the pager panels now depend on) drops. Fix: per-caller held-guard - acquire only on the `!held && isMobile` transition, release only on `held && !isMobile`; clamp at 0. The pager (mobile-only, unmounts on desktop) uses plain mount/destroy acquire/release.

### Scroll-chrome ownership edge cases (BLOCKING, auditors 2, 4)

v8 edits GPL's cleanup from `setScrollContainer(null)` (always clears) to `releaseContainer(centerEl)` (conditional). Auditors flag the `/search` override interaction: when GPL unmounts with a `SearchScopePager` override active, `containerEl === overrideEl ≠ centerEl`, so `releaseContainer(centerEl)` is a no-op. Resolution: at steady state exactly one route-layout is mounted and its mount-`$effect` always re-sets `containerEl`, so a stale value is overwritten by the destination's mount - but this must be EMPIRICALLY pinned by a swap test that samples `containerEl` across frames, not asserted. Both layouts use conditional `releaseContainer` cleanup; `setOverride` (nested `/search` case) is unchanged.

### `.page-title` rationale is factually wrong (all 5 auditors)

v8 §7 claims the three tab panels "contain no `.page-title`." False: `ActivityPanel.svelte:147` and `MessagesPanel.svelte:38` both have `<h1 class="page-title">`. The `app.css:166` rule is a no-op on tabs ONLY because tab roots routes do not carry `.appbar-title` (no `headerTitle`, no `deep-header-config.ts` entry → `AppShell.svelte` `appbarHasTitle` is false). Correct the rationale; add a §6 assertion that tab roots never carry `.appbar-title`.

### Concrete edits (MAJOR/MINOR, convergent)

- **Viewport `touch-action`** (auditor 5): preserve `touch-action: pan-y pinch-zoom` on the viewport (GPL `:486` keeps it); v8's terse `height:100%; overflow:clip; position:relative` drops it.
- **`list-scroll.svelte.ts` is fully dead after the edits** (auditors 3, 4): `consume()` is never called; delete the store file, not just the callers.
- **Tab-switch behaviour delta** (auditors 1, 4): removing `window.scrollTo(0,0)` from `switchTo`/`switchBackward` + per-panel `pageScrollStore` restore means switching to a previously-visited tab now RESTORES its saved scroll instead of landing at top. State this explicitly; add a §6 assertion.
- **`.detail-scroll-pane` first-match during the swap** (auditor 4): two `.detail-scroll-pane` exist mid-swap; `getCurrentScrollY` and the discussion page's queries are first-match. Steady-state + `beforeNavigate` (source still mounted) are unambiguous; pin the swap window empirically in §6.4.
- **HMR refcount** (auditors 3, 5): the singleton counter can mismatch the DOM class across HMR; add an `import.meta.hot?.dispose` reset.
- Minor: dead `gpl-preview-pane` class on the overlay markup (auditor 4); dual `pageScrollStore` capture for `/` (auditor 4 - consistent, acknowledge); `items-start` redundancy on the track (auditor 4); snapshot-shape migration note (auditor 4); sibling-spec list accuracy (auditor 5).

## Verified-TRUE facts carried forward (Round 8 additions)

- `app.css:333-341` + `tab-config.ts` labelKeys (`discussions|activity|messages`) match; the flat-white tab surface is pre-provided, no `.gpl-card`.
- The height chain under `fixed-viewport` is unbroken (`app.css:257-279` forces `height:100%` through `dual-column-layout*`); `overflow: clip` is not a scroll container (deleting `resetViewportScroll` is safe).
- `releaseContainer(el)` (`if (containerEl === el) setContainer(null)`) is correct + idempotent for both mount/destroy orderings during the swap, given the destination re-sets on mount.
- `SearchScopePager` uses `setOverride` (a separate slot, `GesturePageLayout.svelte:331` `override ?? centerEl`); it never contends with the pager's direct `setScrollContainer` (search is a deep route, never co-mounted with the tab pager).
- `.appbar-title` is absent on tab roots (`AppShell.svelte` + `deep-header-config.ts`), so the `.page-title` rule is a no-op on tabs for that reason (not because panels lack `.page-title`).
- `listScroll.consume()` has zero callers; `listScrollTop` is dead (snapshot plumbing only). `list-scroll.svelte.ts` is removable.
- The refcount race only EMERGES once the pager co-owns `fixed-viewport` (today GPL is the sole owner); the refcount is a true generalization, and the resize-toggle gap is the one case mount/destroy acquire/release does not cover.
- The existing `tab-swipe-preview-height.spec.ts` `vpHeight`-equality assertion becomes a tautology under the constant screen-height viewport; the §6.1 de-tautologization to section scroll-box geometry is correct and self-aware.

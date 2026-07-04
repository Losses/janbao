# DV19 - Plan Journal

Append-only log of the 5-agent role-less audit loop for the forward-swipe-preview feature (reuse `getPreviewPanel` so Messages → `/search` previews the destination, no new preview wheel). Each round: 5 independent auditors examine `docs/DV19-Plan.md` against the codebase; loop until 5/5 unconditional PASS. Full detail per round in `DV19-Audit-R{N}.md`.

## Round 1 - 1/3 PASS → revised

Three auditors (1 PASS, 2 FAIL). Convergent: `getRouteRule` is not exported (`route-config.ts:298`); the `commit`-bridge flash (`commit` clears `reveal` synchronously, preview vanishes before `goto` lands); the `<messagesTabIndex>` placeholder unresolved; "Effect E settles the page" misattributed. Full detail: `DV19-Audit-R1.md`.

Revision: `preview-panel.ts` uses `ROUTE_CONFIGS.find` directly (no `getRouteRule`); `commit` no longer clears `reveal` synchronously (keeps it during the `goto` gap; `onDestroy` `reset()` clears on success, reject handler on failure); `ForwardEdgeOverlay` takes `activeIndex`; handoff narrative corrected (GPL `shouldAnimateEnter`, not Effect E).

## Round 2 - 0/5 PASS → revised (unanimous: swipeEnd defeats the bridge)

Five auditors, all FAIL on one convergent blocker: `MobileTabPager.svelte:275` calls `forwardEdge.clearReveal()` synchronously after `commit`, defeating the R1 commit-bridge fix (the preview still vanishes on release). The plan did not address line 275. Full detail: `DV19-Audit-R2.md`.

Revision: gate `swipeEnd`'s `clearReveal()` on `target?.kind !== 'deep'`; the deep commit owns the reveal lifecycle (preview bridges the `goto` gap; `onDestroy` `reset()` clears on success; `commit` reject handler retracts on failure). Tab/null cases keep `clearReveal()` (defensive no-op). Keyed on `target.kind` (general), no feature token. Also fixed §4.7 prop count (three props) and §7 unit-test claim (unknown path → active tab panel, not null).

Round 3 will re-verify the bridge (now that `swipeEnd` no longer clears `reveal` for the deep case) and the rest of the design.

## Round 3 - 5/5 PASS, all organic=clean (FINAL). Loop exit.

Five auditors, all PASS, zero blocking, all organic=clean. The R2 fix (gating `swipeEnd`'s `clearReveal` on `target?.kind !== 'deep'`) resolved the bridge blocker: the deep commit owns the reveal lifecycle, the preview spans the `goto` gap, `onDestroy` `reset()` clears it at the route swap (before `/search` mount + Effect E), the reject handler retracts on failure. Full detail: `DV19-Audit-R3.md`.

The `getPreviewPanel` reuse (backward-compatible), the slide-in geometry, `SearchPreviewPanel` (`page.data.t` only, SSR-safe), `shouldAnimateEnter` for `/search`, and the organic-clean gate all re-confirmed across all five auditors.

Carried to implementation (non-blocking): the GPL `snapIndex 0` enter discontinuity (existing enter pattern, more noticeable after the preview); the cancel path is instant-vanish (pre-existing DV18); the geometry shows the rightmost `reveal` px (the search-bar affordance should be right-aligned).

Loop exit condition met at 5/5 PASS, all organic=clean. Plan approved for implementation.

# DV19 - Plan Audit Round 2

5 independent role-less auditors examined the R1-revised `docs/DV19-Plan.md` (which fixed `getRouteRule`, the `commit` bridge, the placeholder, and the handoff narrative). Result: **0/5 PASS, 5/5 FAIL, unanimous, all on one convergent blocker.** The `commit`-bridge fix was defeated by a synchronous `clearReveal` in `swipeEnd` that the plan did not address.

## Tally

| Auditor | Verdict | Organic           | Confidence |
| ------- | ------- | ----------------- | ---------- |
| 1       | FAIL    | has-special-cases | high       |
| 2       | FAIL    | clean             | high       |
| 3       | FAIL    | clean             | high       |
| 4       | FAIL    | clean             | high       |
| 5       | FAIL    | clean             | high       |

Result line: **0/5 PASS → revised.**

## Convergent blocker

### R2-B1 (5/5, critical); `swipeEnd` clears `reveal` synchronously after `commit`, defeating the bridge

`MobileTabPager.svelte:275` calls `forwardEdge.clearReveal()` unconditionally in the forward-commit branch, immediately after `forwardEdge.commit(target.href)` (`:270`):

```
269  } else if (target?.kind === 'deep') {
270      forwardEdge.commit(target.href);
271  }
272  dragOffset = null;
273  showDeepPreview = false;
274  backChipReveal = null;
275  forwardEdge.clearReveal();   // clears reveal synchronously; the bridge is defeated
```

Even with the R1 fix (commit no longer clears `reveal`), line 275 nulls it on the very next tick. `ForwardEdgeOverlay`'s `{#if reveal !== null}` falsifies; the preview vanishes before `goto` resolves; bare Messages shows during the gap. The R1-B2 flash persists unchanged. The plan's §4.5 said "No change to the dispatch / commit (DV18 stands)" and §5 listed only `forwardTarget` for MobileTabPager; neither mentioned line 275.

All five auditors independently traced this and returned FAIL.

## Non-blocking concerns (consensus)

- §4.7 said "one prop" but the plan specifies three (`target`, `viewportWidth`, `activeIndex`).
- §7 unit-test claim "null for an unknown path" is wrong (the fallback returns the active tab's panel; null only for an out-of-range index).
- The inner panel `bg-base-100` mostly matches `/search`'s `.gpl-card`, but the surrounding `.scroll-pane` is `bg-base-200` (`app.css:325-331`); minor colour pop possible.
- `goto` resolves (not rejects) on load errors, so the reject handler is effectively dead for the common failure mode (the preview stays until unmount; acceptable, rare).
- A brief `snapIndex 0` Messages-preview on `/search` mount is the existing enter pattern (same as tap-search); the preview bridges the pre-mount gap.

## Verified-TRUE (re-confirmed)

The `getPreviewPanel` reuse (ROUTE_CONFIGS.find backward-compatible), the geometry, the SearchPreviewPanel `page.data.t`-only + SSR-safe, the z-order, `shouldAnimateEnter` for `/search`, the `/search` route-config reachability, and the organic-clean gate (no feature token in MobileTabPager's forwardTarget/props) all held across all five auditors.

## Revision decision

Gate `swipeEnd`'s `clearReveal()` on `target?.kind !== 'deep'` so the deep commit owns the reveal lifecycle (the preview bridges the gap; `onDestroy` `reset()` clears on success; the `commit` reject handler retracts on failure). The tab/null cases keep `clearReveal()` (defensive; `swipeMove` only sets `reveal` for the deep case, so it is a no-op there). Keyed on `target.kind` (general dispatch), not a feature token. See Round 3.

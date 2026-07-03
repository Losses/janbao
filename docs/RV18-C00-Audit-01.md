# RV18-C00 - Implementation Audit Round 01

5 independent role-less auditors examined the DV18 implementation (the working-tree code) against `docs/DV18-Plan.md` + the codebase. Result: **5/5 PASS, zero blocking**, organic 4 clean / 1 has-special-cases. The one organic flag is real: `/search` appears in `MobileTabPager.svelte` comments, violating the plan's strict organic-clean gate even though it is comments-only (no runtime impact).

## Tally

| Auditor | Verdict | Blocking | Organic           | Confidence |
| ------- | ------- | -------- | ----------------- | ---------- |
| 1       | PASS    | 0        | has-special-cases | high       |
| 2       | PASS    | 0        | clean             | high       |
| 3       | PASS    | 0        | clean             | high       |
| 4       | PASS    | 0        | clean             | high       |
| 5       | PASS    | 0        | clean             | high       |

Result line: **5/5 PASS, zero blocking; organic not yet all-clean.**

## Verified at the source (the implementation is correct)

All five confirmed the implementation matches the plan and works:

- `resolveForwardTarget` (forward-edge.ts) returns tab/deep/null correctly; unit tests 3/3 pass.
- The `forwardEdge` store (forward-edge.svelte.ts) mirrors `active-gesture-track.svelte.ts`; `commit`'s `void goto(href).then(settleInFlight, settleInFlight)` clears `inFlight` on settle and swallows rejection (more correct than the plan's illustrative `.finally`); `reset()` clears both fields; `initForwardEdgeStore`/`getForwardEdgeStore` follow the singleton pattern.
- `MobileTabPager.svelte` dispatches by `target.kind` (tab → `switchTo`, deep → `forwardEdge.commit`, null → rubber-band); the existing Discussions/Activity forward swipes route through the resolver unchanged; the `dragging` predicate includes `forwardEdge.reveal`; `reset()` in `onMount`/`onDestroy`; `<ForwardEdgeOverlay />` in the viewport.
- `ForwardEdgeOverlay.svelte` uses `mdiArrowRight` (generic forward arrow), z-30 below the FAB z-35, `pointer-events: none`, 40 px inset; reactive via `$derived(forwardEdge.reveal)`.
- `tab-config.ts` four `forwardDeepNeighbour` sites; `MOBILE_TABS` spreads `...tab`.
- The dragging-flush is deterministic via the `onMount` return-teardown (`pager.dragging = false` on unmount, before `/search` mounts and Effect E fires).
- `goto` lives only in the store's `commit`; no `goto` call in `MobileTabPager.svelte`.

## The organic flag (round-2 fix)

`MobileTabPager.svelte:222` and `:266` carry comments containing the literal `Messages -> /search`. The plan §4.10/§7 and the C00 journal assert "no `/search` literal and no `search`/`peek` string token enters `MobileTabPager.svelte`"; the comments make that assertion false. Comments-only (no code-level `/search` literal, no `goto`, no `peek`), so no runtime impact, but the strict gate and the journal's verification of it are inaccurate. Auditor 1 flagged this as has-special-cases; auditors 2-5 judged the gate's intent (no special-case code) satisfied and returned clean.

## Non-blocking concerns (carried to round 2 / implementation)

- The `wasDeepPreview` back-commit branch (`MobileTabPager.svelte` swipeEnd) does not call `forwardEdge.clearReveal()`, unlike the forward and cancel branches. Not a defect (`swipeMove`'s back-edge branch clears the forward reveal, so it is already null), but asymmetric. Add for defensive symmetry.
- `resolveForwardTarget` does not clamp negative `activeIndex` (`-1` returns `{kind:'tab', index:0}`); unreachable in practice. Optional defensive guard.
- `ForwardEdgeOverlay` icon paints outside the bg for very small reveals (<60 px); mirrors the back-chip; self-corrects. Minor UX.
- Journal citation drift (onMount return-teardown at `:146`, not `:140-141`). Doc-only.

## Revision decisions

1. Remove `/search` and `Messages -> /search` from the two `MobileTabPager.svelte` comments so the file is genuinely token-free (the organic-clean gate and the journal's claim become true).
2. Add `forwardEdge.clearReveal()` to the `wasDeepPreview` back-commit branch for teardown symmetry.

Round 2 will re-verify the organic-clean gate (now that the comments are clean) and the two fixes.

# DV17 - Plan Audit Round 02

5 role-less open-ended auditors re-examined the Round-1 revision of `docs/DV17-Plan.md`. Auditor 4 returned a connection error mid-response (incomplete, excluded). Result of the 4 valid auditors: **0/4 PASS, 4/4 CHANGES_REQUESTED** (all high confidence). The Round-1 `tapMorph` design resolved the seven Round-0 blockers: B1, B2, B4, B6, B7 fully RESOLVED; B3 and B5 PARTIAL. Five new, narrower specification issues survived (all concrete and fixable; none threatens the `tapMorph` approach). Round-3 input is the revision in "Revision decisions".

## Tally

| Auditor | Verdict           | New blocking | Round-0 B-status            | Confidence |
| ------- | ----------------- | ------------ | --------------------------- | ---------- |
| 1       | changes_requested | 2            | B1✓ B2✓ B3∆ B4✓ B5✓ B6✓ B7✓ | high       |
| 2       | changes_requested | 2            | B1✓ B2✓ B3∆ B4✓ B5✓ B6✓ B7✓ | high       |
| 3       | changes_requested | 3            | B1✓ B2✓ B3∆ B4✓ B5✓ B6✓ B7✓ | high       |
| 4       | (incomplete)      | -            | -                           | -          |
| 5       | changes_requested | 2            | B1✓ B2✓ B3∆ B4✓ B5∆ B6∆ B7✓ | high       |

(✓ = RESOLVED, ∆ = PARTIAL.)

## Round-0 blocker resolution (consensus)

- **B1 RESOLVED (4/4).** The new `morph` arm `if (pager.tapMorph !== null) return pager.tapMorph`, placed between the drag arm (`Header.svelte:150`) and the settle arm, returns a continuous value on a tap without setting `dragging: true`. It does not latch `lastGestureMorph` (Effect A only writes when `dragging`) and does not arm a phantom settle (Effect C is title-driven; `/` and `/search` both have empty titles).
- **B2 RESOLVED (4/4).** `tapMorph` is an independent field the drag `$effect` (`GesturePageLayout.svelte:344-443`) never writes.
- **B4 RESOLVED (4/4).** `iconProgress` (`Header.svelte:194`) freezes on `tapMorph !== null`; verified no back-arrow flash on enter or exit.
- **B6 RESOLVED (4/4).** `resolveHeaderMode` import; no literal `/search` token in GPL (grep-confirmed); no circular dependency; the relocation is documented. Borderline under a strict separation-of-concerns criterion but acceptable.
- **B7 RESOLVED (4/4).** Linear `tapMorph` easing yields `searchProgress` over `morph [0.2,1]` = 160ms (verified: linear `morph=1−t` crosses 0.2 at `t=0.8`).

## New blocking issues (Round 1 → Round 2)

**NB1 (4/4) - `slideT` must NOT gain `navInFlight`; the plan unifies all four gates incorrectly.** `Header.svelte:205-207` + the load-bearing comment at `:195-204`. Today `slideT = dragging || searchScrubbing` and deliberately EXCLUDES `navInFlight` (it would suppress the deep→root "Tab descent" descent on every GPL route, not just `/search`). The Round-1 plan §4.4 item 5 collapses all four gates to `dragging || tapMorph !== null || navInFlight`, silently adding `navInFlight` to `slideT`. Fix: `slideT` gates on `dragging || pager.tapMorph !== null` only; `trackStyle`/`searchButtonStyle`/`tabBarStyle` keep `navInFlight` (they already have it).

**NB2 (2/4) - the tap rAF has no clean write path for `tapMorph`.** `mobile-pager.svelte.ts:58-65`. `set` writes all fields atomically. The Round-1 preservation rule `tapMorph = update.tapMorph ?? currentTapMorph` cannot distinguish "omitted" from "explicitly null" (both preserve), so no caller can clear `tapMorph` via `set`; and routing the per-frame rAF through `set` requires hand-pumping the other six fields (read-then-write race, `coverProgress` null-clobber risk). Fix: add a `setTapMorph(value: number | null)` field-level setter to `PagerStore`; the rAF is its sole caller; the drag `$effect`'s `set` calls omit `tapMorph` and the `set` body preserves it via `update.tapMorph !== undefined ? update.tapMorph : currentTapMorph`.

**NB3 (2/4) - first-paint flash on `/` → `/search` enter; the rAF arms one frame late.** `Header.svelte:408-432` (the deleted Effect E) was `$effect.pre`, visible to the same render that flips `currentHasTabs`. The Round-1 plan arms the rAF in `/search` GPL `onMount`, which runs AFTER the first render. At that first render `tapMorph` is still `null`, so `morph` rests at `currentHasTabs ? 1 : 0 = 0` → `searchProgress = 1` (search fully visible), then the rAF publishes `tapMorph = 1` next frame → search hides → re-reveals over the scrub. Fix: arm in a `$effect.pre` (mirroring the deleted Effect E's timing), setting `tapMorph` to its start value synchronously before the first post-nav render.

**NB4 (1/4, auditor 5) - the EXIT arming check uses the wrong `prevPath` source.** `src/routes/+layout.svelte:74` registers a `beforeNavigate` that calls `navStore.handleBeforeNavigate` (`navigation-logic.ts:137-163`) BEFORE GPL's `beforeNavigate` fires. By the time GPL's `beforeNavigate` runs, the stack is already popped (popstate) or pushed (link). `navStore.activeStack[len-2].pathname` is `undefined` on popstate (crash) or equals the source `/search` on a same-tab link (misfire, rAF never arms). Fix: the exit check compares the CURRENT path's mode (`page.url.pathname`, still `/search` inside `beforeNavigate`) against the TARGET path's mode (`navigation.to.url.pathname`, the `beforeNavigate` argument), not the stack.

**NB5 (1/4, auditor 3) - `tapVisualOffset` formula is unspecified.** §4.4 item 3 says "mirrors `visualDragOffset`" but never converts the unitless `tapMorph` (0..1) to pixels. The sync invariant rests on this conversion. Fix: state the formula explicitly: `tapVisualOffset = sign · W · max(0, (tapMorph − HEADER_MORPH_THRESHOLD) / (1 − HEADER_MORPH_THRESHOLD))`, with `sign` from the enter vs exit direction; the `trackTranslateX` tap branch combines it with the `−ACTIVE·STEP_PERCENT%` base.

## Notable concerns (non-blocking)

- **Effect B arms a settle on the exit tap** (`Header.svelte:234-291`, tracks `pendingNav`). Pre-existing today (the same-panel `beforeNavigate` sets `pendingNav`); `morph`'s `tapMorph` arm takes precedence for the rAF duration, `titleView` renders an empty crossfade (both endpoints `''`), `endSettle` fires via Effect D. Not new in DV17; the verification list should mention it.
- **`coverProgress` / FAB works by accident.** `/search` is overlay family; the FAB reads `pager.coverProgress ?? 0` and rests at 0. The Round-1 split means the rAF does not touch `coverProgress`; practical impact nil, but the plan should state this rather than claim it "resolves" the concern.
- **rAF natural-completion behavior.** §4.4 item 2 specifies cancellation but not the `t=1` end. The rAF must clear `tapMorph` to `null` at natural completion so the `snapIndex === ACTIVE` rest position takes over from `tapVisualOffset` without a jump. State explicitly.
- **Effect E `onDestroy` cleanup** (`Header.svelte:516-519`) cancels `searchScribRafId` and clears `searchScrubbing`; §5's deletion list omits it. Add it.
- **SSR one-frame window** (enter mount, `snapIndex=0` vs `morph=0`): pre-existing today; DV17 does not introduce it. Acknowledged.
- **tap-EXIT e2e untested.** The MIRROR test drives EXIT via CDP drag (drag path). A tap-EXIT (same-panel `beforeNavigate`) e2e is needed to guard the new exit rAF + headroom branch. Add to §7.
- **`tapVisualOffset` directional form** (enter vs exit sign) and the `trackTranslateX` base combination are implementation details the plan should still pin down.

## Organic-clean

Clean under the literal criterion (no `/search` token in shared primitives; grep-confirmed; `resolveHeaderMode` is a general mode utility, no circular dependency). Borderline under a strict separation-of-concerns view (GPL gains header-mode awareness), documented honestly in §4.6. Net-neutral-to-cleaner: Header loses ~50 lines of `/search` machinery.

## Revision decisions (applied to `docs/DV17-Plan.md` as Round 2)

1. **`slideT` gate distinguished (NB1).** `slideT` (`Header.svelte:205-207`) gates on `dragging || pager.tapMorph !== null` (no `navInFlight`, preserving the deep→root descent). `trackStyle`/`searchButtonStyle`/`tabBarStyle` keep `dragging || pager.tapMorph !== null || navStore.navInFlight`. §4.4 item 5 is rewritten to separate the two gate forms.
2. **`setTapMorph` field-level setter (NB2).** `PagerStore` gains `setTapMorph(value: number | null): void`; the tap rAF is its sole caller. The drag `$effect`'s `set` calls omit `tapMorph`; `set` preserves it via `update.tapMorph !== undefined ? update.tapMorph : currentTapMorph`. The rAF clears `tapMorph` to `null` at natural completion via `setTapMorph(null)`.
3. **Arm in `$effect.pre`, not `onMount` (NB3).** The enter rAF is armed in a `$effect.pre` that detects a forward root→search navigation (mirroring the deleted Effect E's timing), setting `tapMorph` to its start value synchronously before the first post-nav render. The exit rAF arms in the same-panel `beforeNavigate` (`:797-822`), also setting `tapMorph` synchronously.
4. **EXIT check uses current-vs-target, not the stack (NB4).** The exit `isSearchFlip` reads `resolveHeaderMode(page.url.pathname)` (source, `/search`) against `resolveHeaderMode(navigation.to.url.pathname)` (target). The enter check keeps `navStore.activeStack[len-2]` (valid at `onMount`/`$effect.pre` post-landing).
5. **`tapVisualOffset` formula stated (NB5).** §4.4 item 3 gives the explicit `sign · W · max(0, (tapMorph − 0.2)/0.8)` form and its combination with the `−ACTIVE·STEP_PERCENT%` base, with the sign from enter vs exit.
6. **§5 adds** the Effect E `onDestroy` cleanup (`Header.svelte:516-519`) to the deletion list. **§7 adds** a tap-EXIT e2e. §4.4 item 2 states the rAF clears `tapMorph` to `null` at natural completion.

Open for Round 3: confirm the `$effect.pre` arming sets `tapMorph` before the first post-nav render with no flash; confirm the exit rAF completes and clears `tapMorph` inside the same-panel window before `onTrackTransitionEnd` dispatches; confirm `setTapMorph` + the `set` preservation rule have no residual race; and confirm the `slideT`/gate split leaves the deep→root descent intact.

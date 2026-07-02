# DV16 - Audit Round 1

5 independent open-ended auditors (no roles, no steering, read-only, no e2e, no git mutation) examined `docs/DV16-Plan.md` against the codebase at `master`. Result: **3/5 PASS, 2/5 changes_requested** (not 5/5; NOT a loop exit). All five agreed the core fix (merge the compose branch into the overlay `coverProgress` read) is correct and thorough for the stated defect; the disagreements are about scope of the documentation surface and one interaction the plan mischaracterized.

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence |
| ------- | ----------------- | -------- | -------- | ------- | ---------- |
| 1       | changes_requested | 1        | 3        | clean   | high       |
| 2       | PASS              | 0        | 5        | clean   | high       |
| 3       | PASS              | 0        | 5        | clean   | high       |
| 4       | PASS              | 0        | 4        | clean   | high       |
| 5       | changes_requested | 1        | 2        | clean   | high       |

Result line: **3/5 PASS → revised.**

## Blocking issues (deduplicated)

### B1 - the plan's audit gate forbids the comment updates the fix makes necessary (auditor 1; auditor 2 concurs as a concern)

`src/lib/components/templates/FloatingActionButtonLayer.svelte:15-39` (the file header block) describes `Family C (compose): discrete resting fraction (0, covered). The discrete-nav CSS transition eases the list<->compose swap.` After the §4.2 branch merge, compose reads `coverProgress` live during a drag, so this description is incomplete. Two adjacent docstrings are affected the same way: `src/lib/components/atoms/FloatingActionButton.svelte:12-17` and `src/lib/utils/fab-scale.ts:67-75` (`familyNeedsSamplerDuringDrag`). The plan's §5 says "No other line in the file changes" and §7's audit gate restricts the diff to "ONLY the `foregroundFraction` branch merge and its comment; no other source line changes." A literal implementer leaves the header block and the adjacent docstrings stale, shipping a fix whose file-level documentation contradicts the code (violating the comments-must-reflect-current-intent rule). The gate must explicitly scope the comment-accuracy updates within FAB-named files.

### B2 - §6.5 "Unaffected" for the cross-tab chip-exit is empirically false (auditor 5)

`FloatingActionButtonLayer.svelte:354-367` `chipExitActive` short-circuits with `if (cfg?.family !== 'list') return false;`, so it never fires for compose. With the compose branch reading `coverProgress`, a cross-tab exit from `/post/discussion` (drawer tap to `/messages/inbox`) routes through the GesturePageLayout chip-exit path (`GesturePageLayout.svelte:761-786`: `cancel()`, `isPendingNavigation`, then `isTransitioningOut` + `setPendingNav`). Throughout that window the GPL `committed` branch publishes `coverProgress = 1` (`GesturePageLayout.svelte:366-368`), so the fixed compose branch yields `foregroundFraction = 1`, `scale = 1`: the discussions-icon FAB renders at z-35 above the GPL's z-30 LoadingChip (messages icon). The constant-0 branch hides it today. The plan's "Unaffected" claim hides a real behavior change. This is parity with the overlay family's existing latent behavior (overlay also reads `coverProgress = 1` during a GPL chip-exit and is not gated by `chipExitActive`), so it is not an isolated new defect, but the plan must either fix it or justify it.

## Convergent non-blocking concerns

- **`coverProgress` "null at rest" prose is wrong on the client (auditors 1, 2, 3, 4).** §3.3, §3.5, §4.4, §4.5, §6.4 say `coverProgress` is `null` at rest. On the client, once the compose route's GesturePageLayout mounts, its pager-publish `$effect` runs the at-rest `else` branch and publishes `coverProgress: 0` (`GesturePageLayout.svelte:357,379`). It is `null` only on the server and in the pre-mount SPA swap window. The `?? 0` fallback yields foregroundFraction 0 either way, so the conclusion is correct; the prose must distinguish the server/pre-mount null from the client-rest 0.
- **TypeScript exhaustiveness after the branch removal (auditors 3, 5).** Removing the trailing constant-0 return leaves the derivation without an exhaustive return path. Cleanest: collapse to a single unconditional `return pager.coverProgress ?? 0` after the `list` early-return, making overlay+compose the default else.
- **Test threshold is lenient (auditors 2, 3, 5).** `maxPreSwapScale > 0.3` is met by the commit-slide alone (cover = 1 → scale = 1). The in-drag peak is `260/393 ≈ 0.66` cover → `scale ≈ 0.32`, barely above 0.3. The metric `preSwapIntermediateCount` (pre-swap frames with scale in (0.1, 0.9)) is already captured at `e2e/fab-compose-backswipe.spec.ts:134` but unused; asserting it `> 0` proves a ramp (not a one-frame pop) independent of the commit-slide.
- **retainedConfig fallback dependency (auditor 3).** On a no-FAB-rule route (`/offline/*`, `/discussions/pN`) `displayConfig` falls back to `retainedConfig` (`FloatingActionButtonLayer.svelte:194-230`); if the last FAB route was compose, `displayConfig.family === 'compose'` and the fix reads `coverProgress` there. This is safe because `MobileTabPager.svelte:103-108` never publishes `coverProgress` and the GPL `onMount` cleanup (`GesturePageLayout.svelte:926`) nulls it, so `coverProgress` is `null` off any mounted GPL. The plan should acknowledge this dependency explicitly.
- **Cancelled-drag edge case (auditor 4).** §6 omits the reversed-finger cancel: `dragOffset → null`, no `pendingNav`, `cover` drops 1 → 0 in one flush, `transitionEnabled` stays false (no `discreteNavInFlight`, no `pendingNav`), so the FAB scale snaps down without a CSS ease. This matches overlay's pre-existing cancel behavior (not a regression), but the plan claims edge-case coverage and should acknowledge it.
- **§9 "discreteNavInFlight unverified" is statically provable (auditor 3).** The `$effect.pre` at `FloatingActionButtonLayer.svelte:239-251` trips on any distinct `fabConfig.family` transition; the fix does not change `fabConfig.family` for compose routes (`route-config.ts:167,172`). The latch behavior is identical pre- and post-fix and is empirically covered by the `fab.spec.ts` Family C forward/back specs. Move from UNVERIFIED to resolved.
- **§7 unit-test list typo (auditor 1).** "the existing `fab-scale.test.ts` / `fab-routes.test.ts` / `fab-routes.test.ts` suites" duplicates the second name. Actual files: `src/lib/utils/fab-scale.test.ts` and `src/lib/utils/fab-routes.test.ts`.

## Verified-TRUE (all five, carry forward)

The core fix is correct and thorough for the stated defect. Every line citation in the plan matches the code. Compose is the only GPL-mounted family that ignores `coverProgress` (grep confirms: list reads the Family A sampler; overlay already reads `coverProgress`; both compose routes flow through the single compose branch at `FloatingActionButtonLayer.svelte:392-394`). The preventive e2e is a real CDP drag keyed to the live pathname (tautology-resistant). The change is entirely inside FAB-named files; no shared primitive is touched; the DV09 organic-clean gate holds trivially. `MobileTabPager` never writes `coverProgress` (only `GesturePageLayout` does), which preserves the forward-tap and discrete-back CSS-ease paths after the merge.

## Revision decisions

The Round-1 revision of `docs/DV16-Plan.md` applies the following changes, mapped to blocker / concern IDs:

1. **Extend the fix to `chipExitActive` (B2).** [B2] The pending-based cross-tab detection is lifted out of the `family === 'list'` guard so it applies to every family: when `navStore.pendingNav` targets a tab different from the FAB's source-list tab, the FAB is forced to scale 0 (a LoadingChip covers the content - the MobileTabPager chip on a list route, or the GesturePageLayout chip on an overlay/compose route). A same-tab `pendingNav` (a normal GPL back-swipe toward the source list) keeps the FAB driven by `coverProgress`. The list-only `navInFlight && direction === 'forward'` fallback (a MobileTabPager cross-tab tap) stays list-only. This fixes the compose chip-exit visibility AND closes the same-cause latent gap for overlay, without regressing the normal back-swipe (same-tab pendingNav is not a chip-exit) or the forward tap. Change is inside `FloatingActionButtonLayer.svelte`; still organic-clean.
2. **Scope the documentation surface (B1).** [B1] §5 "Modified" explicitly includes the file header block (`FloatingActionButtonLayer.svelte:15-39`), the `foregroundFraction` inline comment, and the adjacent docstrings that the fix makes incomplete (`FloatingActionButton.svelte:12-17`, `fab-scale.ts:67-75`). §7's audit gate is revised from "no other source line changes" to "no other FUNCTIONAL line changes; comment-accuracy updates within FAB-named files are required." No shared primitive is touched.
3. **TypeScript-safe collapse (concern).** §4.2 / §5 specify the derivation as: `list` early-returns the sampler fraction; everything else (overlay + compose) unconditionally `return pager.coverProgress ?? 0`. No trailing dead return.
4. **Strengthen the regression assertions (concern).** §7 adds `preSwapIntermediateCount > 0` to both compose DEFECT tests so a ramp (not a one-frame pop) is required, independent of the commit-slide carrying `maxPreSwapScale`.
5. **Correct the `coverProgress` prose (concern).** §3.3, §3.5, §4.4, §4.5, §6.4 state: `coverProgress` is `null` on the server and in the pre-mount SPA swap window; it is `0` at client rest once the GPL `$effect` has flushed; the `?? 0` fallback maps both to foregroundFraction 0.
6. **Acknowledge the retainedConfig + cancel-drag edge cases (concern).** §6 adds: (a) the retainedConfig fallback reads `coverProgress`, which is `null` off any mounted GPL so foregroundFraction is 0 on no-FAB-rule routes; (b) the reversed-finger cancel snaps the scale down without a CSS ease, matching overlay's existing cancel behavior.
7. **§9 cleanup (concern).** Move `discreteNavInFlight` from UNVERIFIED to resolved (statically provable, empirically covered). Keep `/messages/new` parity and add the chip-exit interaction as the Round-2 empirical verify items. Fix the §7 unit-test list typo.

All other DV16-Round-0 design is unchanged: the `foregroundFraction` compose→coverProgress merge, the `discreteNavInFlight` CSS latch for the discrete forward/back, the SSR/resting scale 0, the deep-link no-flash, the organic-clean boundary, the out-of-scope pager-contract unification and family-enum collapse.

Round 2 audit will re-verify the whole plan (open-ended, not a fix-verification pass), with particular attention to the `chipExitActive` extension's safety across the normal back-swipe, the forward tap, and the list-family parity.

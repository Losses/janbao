# DV11 - Audit Round 11

5 independent role-less auditors examined `docs/DV11-Plan.md` (v11) under a clean open-ended prompt. Result: **not 5/5 PASS, but the closest yet.** 4 PASS (auditors 1, 3, 4, 5) / 1 FAIL (auditor 2; 0 blocking, 1 major). The architecture, ownership layer, refcount, deletions, restore timing, and §6.4 arbitration are unanimously endorsed. One real correctness gap drove the lone FAIL.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
| ------- | ------- | -------- | ----- | ----- | ------- |
| 1       | PASS    | 0        | 2     | 3     | has-special-cases |
| 2       | FAIL    | 0        | 1     | 4     | has-special-cases |
| 3       | PASS    | 0        | 0     | 3     | clean   |
| 4       | PASS    | 0        | 0     | 4     | clean   |
| 5       | PASS    | 0        | 2     | 4     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## The FAIL-driver (auditor 2 M1; auditor 1 M1 - same root)

**Per-panel `pageScrollStore` restore keyed on `page.url.pathname` lags `activeIndex` during a programmatic tab switch.** `MobileTabPager.svelte:190-201` `switchTo(index)` sets `activeIndex = index` SYNCHRONOUSLY, then `navStore.navigateForward` → `goto` (async, `navigation.svelte.ts:244-253`). The restore `$effect` (keyed on `[activeIndex, page.url.pathname]`) fires on the `activeIndex` flip while `page.url.pathname` is still the OLD route, so it writes `pageScrollStore.get(oldPathname)` onto the NEWLY-active panel - a visible jump-back during the ~200 ms slide (e.g. scroll `/` to 600 px, swipe to `/activity`: activity briefly receives 600 px, then snaps to its own value). Auditor 1's related concern: `page.url.pathname` is one global value, so keying all three co-mounted panels on it would clobber (each panel must key on its OWN route).

**Fix (v12):** key each panel's capture AND restore by its OWN tab href `MOBILE_TABS[N].href` (deterministic from the panel index, no `page.url.pathname` lag - the GPL left/right pattern, `GesturePageLayout.svelte:963/1007`). The root-layout `beforeNavigate` writes `from.url.pathname`, which for a pager route equals `MOBILE_TABS[activeIndex].href` at steady state, so the keys agree; the lag is eliminated because the pager's key is pure-index-derived.

## Statement-accuracy majors (auditor 5, PASS but flagged)

- **§6.6 "sampler stops on GPL unmount" is false under the plan.** `helpers.ts:482-486` stops `captureExitPreview` only when `querySelector('.detail-scroll-pane')` is null. Under the plan the pager's active panel is ALSO `.detail-scroll-pane`, so landing on a tab root does NOT null it - the sampler continues onto the pager track. At steady state the translated track keeps non-active panels off-screen (<40 % coverage), so `seenTabs` stays clean, but the plan's stated reasoning is wrong. Correct it; verify empirically.
- **§7 "/`↔`/discussions/pN` ... no worse than today" is wrong.** Today both are window-scroll (no boundary); the plan makes `/` locked and leaves `/discussions/pN` window-scroll - a NEW boundary. State it honestly as a new, out-of-scope discontinuity.

## Minors (convergent)

- §6.1 metric under-specified (the existing `vpHeight` assertions become tautological post-fix; spell out the replacement: section `clientHeight === viewport height`, dest `scrollHeight >= clientHeight`, activity.bottom reachable).
- §4 must explicitly REMOVE the `overflow-hidden` Tailwind class (conflicts with the inline `overflow: clip`) and the three `use:measureTab` directives (not just the action definition).
- §4 should state `data-preview-tab={MOBILE_TABS[i].labelKey}` explicitly (the CSS matches the literal labelKey strings).
- §4 should add `-webkit-overflow-scrolling: touch` to the panel style (iOS momentum, GPL parity).
- §4 should state the deep-preview overlay KEEPS `scroll-pane` (load-bearing for header offset); only `gpl-preview-pane` is removed.
- §6.6 should list `header-tab-descent-cross-tab-exit.spec.ts` (it directly exercises the §6.4 swap).
- §4 should note the per-panel `onscroll` capture handler explicitly (GPL `:961-965/1005-1009`).

## Verified-TRUE facts carried forward (Round 11 additions)

- `switchTo` sets `activeIndex` synchronously before the async `goto` (`MobileTabPager.svelte:190-201`, `navigation.svelte.ts:244-253`) - the lag is real; keying by `MOBILE_TABS[N].href` (per-panel, index-derived) eliminates it.
- GPL's left/right panels capture/restore under their OWN href (`resolvedLeftHref`/`resolvedRightHref`, `GesturePageLayout.svelte:224/963/1007`), not the global `page.url.pathname` - the pattern the pager should mirror.
- `captureExitPreview` (`helpers.ts:482-486`) stops on `.detail-scroll-pane === null`; under the plan a tab-root landing does NOT null it (the pager's active panel carries the class) - the sampler-continues claim must be corrected.
- `/`↔`/discussions/pN`: today both window-scroll; the plan makes `/` locked → a NEW boundary (not "no worse than today").
- All prior endorsed facts hold: the architecture, refcount + `held`-guard + clamp, `releaseContainer` self-heal, `setOverride` never contends, `list-scroll.svelte.ts` dead, `data-preview-tab` surface pre-provided, restore sync-first-then-rAF, §6.4 empirical arbitration.

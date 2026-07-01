# DV11 - Audit Round 14

5 independent role-less auditors examined `docs/DV11-Plan.md` (v14) under a clean open-ended prompt. Result: **not 5/5 PASS.** 4 PASS (auditors 1, 2, 3, 4) / 1 FAIL (auditor 5, BLOCKING). v14's architecture (the `.detail-scroll-pane` removal + root-capture `!isPagerRoute` gate) is unanimously endorsed; the lone FAIL was a doc slip in the §5 spec-rewrite bullet.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
| ------- | ------- | -------- | ----- | ----- | ------- |
| 1       | PASS    | 0        | 2     | 4     | has-special-cases |
| 2       | PASS    | 0        | 0     | 3     | has-special-cases |
| 3       | PASS    | 0        | 1     | 3     | has-special-cases |
| 4       | PASS    | 0        | 2     | 3     | clean   |
| 5       | FAIL    | 1        | 1     | 3     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## The FAIL-driver (auditor 5 BLOCKING; auditors 1, 3, 4 MAJOR - same item)

**§5's spec-rewrite bullet still references `.detail-scroll-pane` for the `/`-route e2e rewrites, but v14 removed `.detail-scroll-pane` from the pager.** The §5 bullet (written in v13) instructs rewriting the `fab.spec.ts`/`swipe-forward-back-deep-page.spec.ts` `/`-route assertions to "scroll the active `.detail-scroll-pane`." Under v14 there is no `.detail-scroll-pane` on `/` (`MobileTabPager.svelte` panels carry only `data-tab-panel`/`data-preview-tab`; `.detail-scroll-pane` is GPL's centre, present only on deep routes). An implementer following §5 literally selects `null`. §6.3/§6.4(b) (updated in v14) correctly use `section[data-tab-panel=<activeLabelKey>]`; the §5 bullet was not updated to match. (Author doc slip from the v13→v14 transition.)

## Convergent majors (non-blocking, addressed in v15)

- **`swipe-forward-back-deep-page.spec.ts` no-top-flash test SETUP** (auditors 1, 4): the test's setup (`:482` `window.scrollTo(0, 600)` to seed the source scroll) is also a no-op under `fixed-viewport`; the rewrite must move BOTH the setup AND the assertion to scrolling the active panel, or there is nothing captured to restore.
- **"Sole writer" rationale imprecise** (auditor 4): GPL's left/right preview panels ALSO write the tab-href keys on deep routes (`GesturePageLayout.svelte:963/1007`); the pager is the sole writer only WHILE IT IS MOUNTED (the two layouts never co-mount).

## Verified-TRUE facts carried forward (Round 14 additions)

- The §5 selector slip: `.detail-scroll-pane` is absent on `/` post-v14 (`MobileTabPager.svelte` panels carry only `data-tab-panel`/`data-preview-tab`); the correct selector for the `/`-route e2e rewrites is `section[data-tab-panel=<activeLabelKey>]`.
- The no-top-flash test's setup (`swipe-forward-back-deep-page.spec.ts:482`) is a `window.scrollTo` that becomes a no-op under `fixed-viewport`; the seed must move to scrolling the panel.
- GPL left/right write the tab-href keys (`:963/1007`) but never concurrently with the pager.
- v14's architecture endorsed: `.detail-scroll-pane` removal eliminates the `captureEnterAnimation`/`captureExitPreview` collision and the root-capture clobber; the `!isPagerRoute` gate is the correct fix for the root-capture clobber; the height chain, refcount, `releaseContainer`, `setOverride` separation, `list-scroll` death, and `data-preview-tab` surface all hold.

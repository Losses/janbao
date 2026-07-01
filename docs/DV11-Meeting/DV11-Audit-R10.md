# DV11 - Audit Round 10

5 independent role-less auditors examined `docs/DV11-Plan.md` (v10) under a clean open-ended prompt. Result: **not 5/5 PASS.** 3 PASS (auditors 1, 3, 5) / 2 FAIL (auditors 2, 4; 0 blocking, 2 major each). The architecture remains unanimously endorsed. All 5 auditors flagged one factual error introduced in v10; the two FAILs turn on it plus an over-asserted no-flicker claim.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
| ------- | ------- | -------- | ----- | ----- | ------- |
| 1       | PASS    | 0        | 2     | 6     | has-special-cases |
| 2       | FAIL    | 0        | 2     | 4     | has-special-cases |
| 3       | PASS    | 0        | 2     | 6     | has-special-cases |
| 4       | FAIL    | 0        | 2     | 4     | has-special-cases |
| 5       | PASS    | 0        | 2     | 4     | has-special-cases |

Result line: **not 5/5 PASS → revised.**

## The v10 factual error (all 5 auditors)

v10 §4/§6.2 justified the per-`pathname` keying by calling `/discussions/pN` "a real `(tabs)` pager route at `activeIndex` 0." Verified false by all five: `/discussions/pN` is `src/routes/discussions/[[page=page]]/+page.svelte`, a TOP-LEVEL route rendering `DiscussionListPage` (`DualColumnLayout`, native window-scroll, NO MobileTabPager, NO `fixed-viewport`, NO `.detail-scroll-pane`). `isPagerRoute('/discussions/p2')` is false; `getCurrentTabIndex` returns −1 there. The `(tabs)` group contains only `/`, `/activity`, `/messages/inbox`. So the pager never captures/restores `/discussions/pN`, and the §6.2 pagination sub-test ("restores `pageScrollStore.get('/discussions/p2')`") asserts a mechanism that does not exist on that route. The keying CONCLUSION (by `page.url.pathname`, to match the root-layout `beforeNavigate` capture) is still correct; only the stated rationale and the pagination test are wrong. (Author's error, introduced in v10; auditors caught it.)

## The two FAIL-drivers

- **§6.2 pagination test incoherent** (auditors 2, 4 M1; also 1, 3, 5 M1): consequence of the false premise above. Fix: drop the `/discussions/pN` sub-test; restate the keying rationale truthfully (match the root capture); note `/discussions/pN` is unchanged and that a `/` (locked) ↔ `/discussions/pN` (window-scroll) boundary exists at pagination (out of scope, acknowledged).
- **§6.4(a) "no flicker throughout" over-asserted** (auditor 4 M2; auditor 5 m3): the swap is now TWO-sided (both the pager and GPL own `fixed-viewport`). Svelte does not guarantee mount-before-destroy across a route swap, so the refcount can transiently hit 0 (class removed) if the source tears down before the destination mounts. The plan asserts no-flicker as resolved; it is an unproven ordering the §6.4 sampler must arbitrate, with a stated mitigation if it flickers.

## Convergent specification gaps (MAJOR/MINOR)

- **Restore timing** (auditor 2 M2): the pager's per-panel restore must mirror GPL's pattern - set `scrollTop` SYNCHRONOUSLY in the `$effect`, then re-apply in rAF (not rAF-only), to avoid a top-flash on remount.
- **§6.4(b) `holdThroughNavigation` freeze** (auditor 4 m3): the `/discussion`→`/` direction freezes the Header (`+layout.svelte:89-94`); the "scroll dest panel → Header responds" assertion must scope past the freeze window (forward direction, or after `releaseNavigation`).
- **Stale `deep-page-snapshot.svelte.ts:6` comment** ("fixed-viewport rules don't apply in the pager context") - now false; update it (auditor 5 m5).
- **`tab-exit-preview.spec.ts` / `captureExitPreview`** shares `data-preview-tab` with the pager panels; benign today (sampler stops on GPL unmount; post-swap neighbours off-screen) but unstated and omitted from §6.6 (auditor 5 m4).
- **`measureViewportWidth` remaining body** (width-only after the deletions) under-specified (auditor 5 m6); **`.detail-scroll-pane` class-toggle mechanism** + the dual-class window during a tab switch (auditor 1 m3); viewport `flex: 1 0 auto` keep/drop unstated (auditor 1 m4).

## Verified-TRUE facts carried forward (Round 10 additions)

- `/discussions/[[page=page]]` is a top-level route rendering `DiscussionListPage` (DualColumnLayout, window-scroll), NOT under `(tabs)`, NOT a pager route - the v10 false premise.
- The pager mounts only on `/`, `/activity`, `/messages/inbox` (`(tabs)` group); `getCurrentTabIndex('/discussions/p2')` returns −1, `isPagerRoute` false.
- Per-`pathname` keying is correct because it matches the root-layout `beforeNavigate` capture (`+layout.svelte:65` writes `from.url.pathname`); the root capture reads `getCurrentScrollY()` → `.detail-scroll-pane` (the pager's active panel post-fix), so the two writers agree on `/`.
- The `/`↔`/discussion` swap is now two-sided for `fixed-viewport` (both layouts own it via the refcount); Svelte's mount/destroy ordering across the swap is not guaranteed, so a transient 1→0→1 is possible - the §6.4 sampler arbitrates, with a microtask-deferred-removal mitigation if needed.
- GPL's left-preview restore sets `scrollTop` synchronously in the `$effect` THEN rAF-re-applies (`GesturePageLayout.svelte:286-296`); the pager should mirror this (sync-first) to avoid a top-flash.
- `holdThroughNavigation` freezes the Header for `/discussion`→`/` (`+layout.svelte:89-94`), released in `(tabs)/+layout.svelte:113` afterNavigate - the §6.4(b) assertion window must avoid it.
- The architecture (unify onto `.scroll-pane`/`fixed-viewport` + refcount + `releaseContainer`) remains unanimously correct; all deletions confirmed dead; the `data-preview-tab` flat-white surface pre-provided; `setOverride` never contends.

# RV11-C02 - Implementation Audit Round 01

5 role-less full auditors reviewed the DV11 implementation vs `docs/DV11-Plan.md` (v15, 5/5 FINAL) + the working-tree diff. Result: **2/5 acceptable, 3/5 changes_requested**. The core fix is unanimously endorsed (all panels full-height, clip eliminated, hide-on-scroll works, scroll-restore works). The changes_requested are mechanical (lint gate) + one plan-deviation correctness item.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
| ------- | ------- | -------- | ----- | ----- | ------- |
| 1       | acceptable | 0 | 0 | 3 | clean |
| 2       | acceptable | 0 | 0 | 2 | clean |
| 3       | changes_requested | 1 | 1 | 2 | clean |
| 4       | changes_requested | 4 | 0 | 4 | clean |
| 5       | changes_requested | 0 | 2 | 3 | clean |

Result line: **not 5/5 acceptable → revised.**

## Convergent blockers (lint gate)

All three changes_requested auditors flagged the same class: `bun run lint` exits 1 on DV11 source files.

- **Unused `beforeNavigate` import** (`(tabs)/+layout.svelte`) - Phase 4 removed the capture block that consumed it but left the import. Fix: drop `beforeNavigate` from the import.
- **Inline type in `viewport-lock.svelte.ts`** - `{ acquire: () => void; release: () => void }` violates the zero-tolerance no-inline-typing rule. Fix: named `interface ViewportLock` with `VoidHandler` from `$lib/types/handlers`.
- **Em dashes in new comments** (`GesturePageLayout.svelte`, `MobileTabPager.svelte`) - banned by `local/no-emdash`. Fix: replace with hyphens.
- **Prettier wrapping** (`MobileTabPager.svelte` `onMount` ternary). Fix: `prettier --write`.

**All four fixed in this revision.** DV11 source files now pass eslint (0 errors) + prettier (all matched files) + svelte-check (0/0, 1431 files). The `bun run lint` exit 1 is only `docs/*.md` (prettier markdown) + `src/app.css` (pre-existing since DV09).

## Convergent major (plan deviation)

- **`onDestroy` uses unconditional `setScrollContainer(null)` instead of `releaseContainer`** (auditor 5 M1). The plan mandated `releaseContainer` for both layouts' cleanup. The journal's deviation #1 rationale (the Svelte 5 same-flush re-run detaching the listener) applied to the `$effect` cleanup, NOT to `onDestroy` (which fires once, no same-flush re-run). Fix: changed `onDestroy` to `scrollChrome.releaseContainer(activeSectionEl)`. Verified: affected specs still pass (3/3).

## Convergent minors (non-blocking)

- `deep-page-snapshot.svelte.ts:6` stale comment - deferred (cosmetic).
- §6.4(a)/(b) empirical test pins not added - the proactive microtask-deferral structurally eliminates the flicker risk; the §6.4(b) SPA-swap is covered by `header-hide-on-scroll.spec.ts` (which auditor 2 confirmed passes on the deep page after SPA nav).
- Stale spec narrative in `tab-swipe-preview-height.spec.ts` (the file's top comment describes the old model).
- Redundant `setScrollContainer` in onMount (idempotent; harmless).

## Process note: e2e cross-contamination

The user flagged that all 5 audit agents independently ran e2e tests, causing cross-contamination (shared port 5174, concurrent chromium, OOM kills, CDP timing drift). Auditor 4 documented this ("different failing tests each run: 1, then 4, then 2; passed in isolation on alternate ports"). Future audit rounds will explicitly forbid running e2e (audit the diff + code statically; trust the journal's test results).

## Verified-TRUE facts (empirically confirmed by all auditors)

- Core fix works: all three panels `offH=727` (screen height), `clipBelowVp=0px`, reachability probe passes.
- Hide-on-scroll driven by panel scroll: `fab.spec.ts` scroll-hide + pointer-events pass.
- No-top-flash scroll restore: `swipe-forward-back-deep-page` passes.
- `fixed-viewport` lifecycle correct across SPA swap: `header-hide-on-scroll` passes on deep page after SPA nav from tab route.
- The 6 full-suite failures are all pre-existing DEFECT specs (not DV11 regressions): verified by `git diff` showing DV11 touches none of those files' assertion logic.
- `list-scroll.svelte.ts` deletion is clean (zero remaining references).
- Organic: clean (no feature tokens in shared primitives).

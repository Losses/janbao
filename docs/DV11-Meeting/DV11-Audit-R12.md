# DV11 - Audit Round 12

5 independent role-less auditors examined `docs/DV11-Plan.md` (v12) under a clean open-ended prompt. Result: **not 5/5 PASS, but essentially converged.** 4 PASS (auditors 1, 2, 3, 4) / 1 FAIL (auditor 5; 0 blocking, 1 major). The architecture, ownership layer, refcount, per-panel `MOBILE_TABS[N].href` keying (the v12 fix), deletions, restore timing, §6.4 arbitration, and §6.6/§7 corrections are all unanimously endorsed. The lone FAIL is a concrete spec-rewrite omission.

## Tally

| Auditor | Verdict | Blocking | Major | Minor | Organic |
| ------- | ------- | -------- | ----- | ----- | ------- |
| 1       | PASS    | 0        | 2     | 4     | has-special-cases |
| 2       | PASS    | 0        | 0     | 3     | clean   |
| 3       | PASS    | 0        | 0     | 4     | has-special-cases |
| 4       | PASS    | 0        | 3     | 4     | has-special-cases |
| 5       | FAIL    | 0        | 1     | 2     | clean   |

Result line: **not 5/5 PASS → revised.**

## The FAIL-driver (auditor 5 M1)

**`e2e/reproduce-swipe-back-preview-bug.spec.ts:138` asserts `landedMetrics.htmlHasFixedViewport === false` after landing on `/messages/inbox`.** Under v12 every tab route acquires `html.fixed-viewport` (the pager's `viewportLock.acquire()`), so this becomes `true` and the assertion FAILS. v12 §6.6 enumerated `fab.spec.ts`, `swipe-forward-back-deep-page.spec.ts`, `tab-exit-preview.spec.ts`, `header-tab-descent-cross-tab-exit.spec.ts`, etc., but OMITTED this spec. Its `:89` counterpart (`htmlHasFixedViewport === true` during the `/bookmarks` GPL preview) stays correct, but `:138` and the padding/childRect equivalence assertions (`:143-147`, comparing a GPL-rendered preview against a now-`fixed-viewport` pager landing) need a deliberate rewrite. (Author's oversight; the same class as the fab/swipe-deep rewrites. The grep confirms this is the ONLY other spec asserting on `fixed-viewport`.)

## Convergent PASS-auditor majors (addressed in v13 for convergence)

- **§6.1 reachability probe** (auditor 1 M1): the existing `panel()` helper measures `offsetHeight`/`getBoundingClientRect`, which cannot prove internal-scroll reachability (the load-bearing post-fix invariant). Add a concrete probe: `el.scrollTo(0, el.scrollHeight); assert el.scrollTop > 0` (content is reachable by internal scroll, not clipped by a shorter viewport).
- **§6.6 `tab-exit-preview` framing** (auditor 4 M1): v12 lists it under "remain green" while the §6.6 NOTE simultaneously flags the `captureExitPreview` continuation as "verify empirically." Internal contradiction. Reframe: mark it "verify empirically (rewrite if the foreign-tab check trips during the GPL→pager settle)," not "remain green."
- **`releaseContainer(centerEl)` override precision** (auditor 1 M2 / auditor 4 note): GPL's effect sets `containerEl = override ?? centerEl`; the cleanup should release the actually-SET element (`override ?? centerEl` captured at effect-run time), not the bare `centerEl`, so an override-active teardown releases the right element. (The `/search`→`/` path is low-risk - Svelte tears down a destroying component's effects without re-running - and §6.4(b) empirically pins it, but the instruction should be precise.)

## Verified-TRUE facts carried forward (Round 12 additions)

- `reproduce-swipe-back-preview-bug.spec.ts` is the ONLY e2e besides the already-listed ones that asserts on `htmlHasFixedViewport` (`:89` true on `/bookmarks` preview - stays; `:138` false on `/messages/inbox` landing - breaks under v12). No other `fixed-viewport`/`window.scrollY`-on-tab assertions exist outside `fab.spec.ts` and `swipe-forward-back-deep-page.spec.ts` (grep-confirmed).
- The v12 per-panel `MOBILE_TABS[N].href` keying is verified correct: `switchTo` sets `activeIndex` sync before async `goto` (`MobileTabPager.svelte:190-201`), so an index-derived key does not lag; the root-layout `beforeNavigate` writes `from.url.pathname` which for a pager route equals `MOBILE_TABS[activeIndex].href` - keys agree (all five auditors confirmed).
- All prior endorsed facts hold: the architecture, refcount + `held`-guard + clamp, `releaseContainer` self-heal, `setOverride` never contends, `list-scroll.svelte.ts` dead, `data-preview-tab` surface pre-provided, restore sync-first-then-rAF, §6.4 empirical arbitration, the `/`↔`/discussions/pN` NEW boundary disclosed.

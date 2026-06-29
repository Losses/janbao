# DV08 - Audit Round 1

Workflow `wf_80984eba-478`. 5 independent role-less auditors. Result: **0/5 PASS** (all FAIL, high confidence). Full structured verdicts in the workflow output; blocking issues summarized below.

## Tally

| Auditor | Verdict | Blocking | Concerns | Organic           | Confidence |
| ------- | ------- | -------- | -------- | ----------------- | ---------- |
| 1       | FAIL    | 3        | 7        | has-special-cases | high       |
| 2       | FAIL    | 2        | 5        | has-special-cases | high       |
| 3       | FAIL    | 4        | 8        | has-special-cases | high       |
| 4       | FAIL    | 3        | 7        | has-special-cases | high       |
| 5       | FAIL    | 2        | 5        | has-special-cases | high       |

## Blocking issues (deduplicated)

**B1 - Boundary handoff not achievable with current `detectSwipe` (CRITICAL, 5/5).** Inner `SearchScopePager.detectSwipe` cannot "yield leftward at scope 0" so the ancestor `GesturePageLayout` claims the back-swipe, while keeping `swipe.ts`/`GesturePageLayout` unmodified. `detectSwipe` claims on any horizontal drag (swipe.ts:404-412); `disabled` is onDown-only (direction unknown); pointer capture is exclusive; `c05594c`/`DualColumnLayout.svelte:111-116` document this exact race and resolve it by disabling one detectSwipe. The plan's own "neighbor-in-direction guard consulted in the deciding phase" IS a `swipe.ts` modification, contradicting its audit gate.

**B2 - Factory `$state` is module-scoped (HIGH, 1,2,3).** `mobile-pager.svelte.ts:35-38`. A naive rename leaves primary and search instances sharing state. `$state` must move into the `createPagerStore` closure.

**B3 - Header at-rest layer wrong (HIGH, 1,3,4).** `GesturePageLayout` publishes `deepMorph:0` (not null) at rest on `/search` (line 330). `progress = pager.deepMorph` → morph=0 → back-arrow shown, not the searchLayer. Need an explicit (mode, backMorph) layer table; deep and search invert the at-rest meaning of 0.

**B4 - Stretchy underline contracts (HIGH, 2,4).** `leadingPos=(a+1)*c` fixed → width→0 as t→1, contradicting "settles back to c". Leading edge must move source-right→target-right: `(a+1+t)*c`. Leftward branch + boundary clamps unspecified.

**B5 - `GesturePageLayout` IS modified (HIGH, 5).** `deepMorph→backMorph` rename = 5 `pager.set()` sites (288,318,325,330,691). "Zero modification" framing false; reword gate to "no new branch, mechanical rename, 0/null contract preserved".

**B6 - `setScrollContainer` double-registration (HIGH, 4).** `GesturePageLayout` registers `centerEl`; scope panels registering separately fight and cleanup can revert to window. Fix: option (b), scope panels scroll inside `centerEl`.

**B7 - Dropping `?page=` regresses shareability (HIGH, 4).** `?page=` is URL-driven today; requirement #3 keeps `?scope=` URL-driven. Keep `?page=` for the active scope.

## Notable concerns (non-blocking)

- SearchTabBar placement (rides the back-swipe morph or not) - auditor 5.
- Header input autofocus vs `html.fixed-viewport` keyboard layout race - 3,4,5.
- Eager 4-scope FTS cost ×4 per debounced keystroke; `discussionsFtsHits`/body-hit unbounded - 1,2,3,5.
- `sort=replies` clamp is UX-only (DAO default-branch already falls back) - 1,2,4,5.
- 40px edge dead-zone unchanged from today (no regression) - 1,5.
- Multi-touch / HMR with two pager stores - 1,3,4.
- `resolveDeepHeaderTitle('/search')` becomes dead config - 4,5.
- a11y of the non-functional magnifier (avoid focusable handler-less button) - 4.

## Verified-TRUE claims (carry forward)

`/search` wrapped by `GesturePageLayout` (search/+page.svelte:100); `deepMorph` published during `/search` back-swipe; pager-store writer/reader set complete (MobileTabPager, GesturePageLayout write; Header, MobileTabBar read); `DualColumnLayout`'s detectSwipe disabled on `/search`; `?page=` only consumed by search route; DAOs clamp `sort=replies`; `overflow:clip` correct; i18n keys exist; `tab-config`/`navigation-logic` need no `/search` change.

# DV12 - Audit Round 1

5 independent role-less auditors examined `docs/DV12-Plan.md` against the codebase at `master`. Result: **NOT 5/5 unconditional PASS. Loop continues.** Tally: 2 FAIL, 3 PASS (all 3 PASS were based on a wrong branch identification and 2 of them carried a blocking finding, so none counts as unconditional). The plan is revised for Round 2.

## Tally

| Auditor | Verdict              | Blocking                     | Branch ID            | Organic | Confidence |
| ------- | -------------------- | ---------------------------- | -------------------- | ------- | ---------- |
| 1       | PASS (with blocking) | 1 (clearPendingNav clear)    | cross-tab (WRONG)    | concern | high       |
| 2       | FAIL                 | 2 (premise wrong; §4.3 risk) | same-panel (CORRECT) | concern | high       |
| 3       | PASS (with blocking) | 1 (clearPendingNav clear)    | cross-tab (WRONG)    | clean   | high       |
| 4       | PASS                 | 0                            | cross-tab (WRONG)    | clean   | high       |
| 5       | FAIL                 | 2 (premise wrong; §4.3 risk) | same-panel (CORRECT) | concern | high       |

Result line: **0/5 unconditional PASS. Round 1 fails the loop-exit condition.**

## Calibration (the load-bearing meta-finding)

Three of five auditors (1, 3, 4) mis-traced which `GesturePageLayout.beforeNavigate` branch the spec's `/bookmarks` → `/messages/inbox` back-arrow path takes, concluding "cross-tab chip branch." Two (2, 5) correctly traced "same-panel branch." The owner verified against source; the same-panel branch is correct:

- `GesturePageLayout.svelte:112-120` `resolvedLeftHref` = `pendingNav?.href ?? lockedLeftHref ?? leftHref ?? navStore.backTarget`.
- `/bookmarks/+page.svelte:51` passes no `leftHref`/`centerTab`; `lockedLeftHref` (set by the effect at `:97-108` while at rest) = `navStore.backTarget`.
- `navigation-logic.ts:57-64` `backTargetFor` returns `stack[stack.length-2]`. Reaching `/bookmarks` from `/messages/inbox` pushes onto `stacks[2]` (messages tab, since `/bookmarks` is a global route → `getTabFromPath` returns the active tab 2), so `backTarget = /messages/inbox`.
- `GesturePageLayout.svelte:759` `matchesPreRenderedPanel = to.url.pathname === resolvedLeftHref || ...` = `/messages/inbox === /messages/inbox` = **true** → same-panel branch (`:789-814`), not the cross-tab chip branch (`:762-786`).

The probe data (`window.__headerLog`) recorded `navInFlight=true, slideT=none` at the landing, which both branches produce, so it did not distinguish them; the plan's §2 inference "cross-tab chip path" was unsupported. This is exactly the DV04 calibration lesson: verify a lone-CRITICAL (and here, a majority-disputed) finding against source before accepting it. The majority was wrong on a subtle trace.

Auditor 3's reasoning ("no centerTab so matchesPreRenderedPanel===false") is a non sequitur: `centerTab` gates `hasLeft` and the panel render path, not `matchesPreRenderedPanel`, which depends only on `to === resolvedLeftHref`. Auditor 4's reasoning ("resolvedLeftHref = fallbackRoute='/'") is wrong: `fallbackRoute` is not in the `resolvedLeftHref` formula.

## Convergent blockers (the revision drivers)

- **[CRITICAL, 2/5 explicit + owner-verified] The defect is branch-agnostic; §4.2 does not fix it.** Both GPL exit branches call `setPendingNav` → `executePendingNav` → `navInFlight=true` at landing → `slideT='none'` → tabs jump. The spec's scenario takes the same-panel branch (`:813`), where §4.2 sets no `crossTabChip`. Even for routes that do take the cross-tab branch, §4.2 leaves the same-panel branch unfixed. Any flag scoped to one branch cannot work. (Auditors 2, 5; owner source-verified.)
- **The `(navInFlight && !settling)` term is vestigial in its `navInFlight` part.** `git blame` (commit `c2c7616`, "fix: Header animation issue", 2026-06-29) shows the term was refactored from `dragging || navInFlight` to `(navInFlight && !settling)`. The `&& !settling` carve-out exempts the gesture-settle path. But for the gesture path the term is never true anyway (settling=true throughout the in-flight window; Effect D at `Header.svelte:351-362` clears settling only when `!navInFlight`, so the two clear together). The term is true ONLY for click navigations (no gesture → no settle → settling=false), where it suppresses the landing transition and causes the jump. Removing the `navInFlight` part fixes the click-landing case and changes nothing for gestures. (Auditors 2, 5 direction; owner-verified.)
- **[disagreement to resolve empirically] §4.3 (remove the whole term) vs Variant B (`dragging || searchScrubbing || settling`).** Auditor 5 claims §4.3 is unsafe because "Svelte interpolates morph frame-by-frame via settleProgress" and the CSS transition would double-animate. The owner traced `runSettleDriver` (`Header.svelte:420-444`): `settleProgress` jumps to `settleTarget` in ONE rAF (`:428`), it does not interpolate frame-by-frame; the CSS transition animates that single jump. Current `slideT` during settle is already `'200ms'` (the term `(navInFlight && !settling)` is false when `settling=true`), and `e2e/header-tabs-replay.spec.ts` passes. So §4.3 keeps settle behavior byte-identical to current; Variant B would CHANGE settle to `'none'` and risk snapping the gesture release. The plan adopts §4.3 (remove whole term) as primary; the gesture-suite e2e is the empirical gate that decides (memory `svelte-effect-pre-same-flush-rerun`: do not trust static reasoning).
- **Citation drift (3/5).** `onBack` is at `Header.svelte:687-699` (plan said 654-666). Effect D is at `:351-362` (plan said 327-361). `beforeNavigate` early-return guard at `GesturePageLayout.svelte:741-748` (plan said 737-744). Gesture `setPendingNav` callers at `:639,651,662,689,699` (plan said 635,647,658,685,695).
- **§4.2 organic concern (3/5).** `crossTabChip`/`lastExitChip` is a Header-layer concern leaking into the shared `NavigationStore` + `GesturePageLayout`. Dropped in Round 2 (the fix becomes Header-local).
- **`clearPendingNav` latch cleanup (2/5, now moot).** Under §4.2 the latch needed clearing in `clearPendingNav` (`navigation.svelte.ts:187-189`) and the orphan branch (`GesturePageLayout.svelte:577-580`), not just `handleAfterNavigate`. Moot: Round 2 drops the latch.

## Non-blocking (carried)

- The title layer (`layerDownStyle:536`) also reads `slideT`; the fix animates both layers on back-to-tab (desired: they are the two halves of one morph). For deep-to-deep `layerDownStyle` is `translateY(0)` always (`isDeepToDeep`), so no regression to `header-title-crossfade-clip-defect`. (Auditor 5.)
- `trackStyle`/`searchButtonStyle`/`tabBarStyle` (`Header.svelte:~587,599,606`) read `navInFlight` directly (not via `slideT`); they stay suppressed during a chip exit. These are the horizontal search track, only visible in `isSearch` (false on `/bookmarks ↔ /messages/inbox`), so no visible regression, but the plan documents the inconsistency. (Auditor 4.)
- `__headerLog` window global is overloaded with two shapes (this probe vs `header-tabs-replay.spec.ts`'s `HeaderSamplerState`). Pre-existing hygiene issue; out of scope. (Auditor 3.)

## Revision decisions (Round 2 plan)

1. **Primary mechanism → remove the whole `(navStore.navInFlight && !settling)` term** from `slideT` (`Header.svelte:193-196`), becoming `dragging || searchScrubbing ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out'`. Branch-agnostic; fixes both same-panel and cross-tab back-to-tab landings; preserves the gesture-settle behavior (slideT stays `'200ms'` during settle, byte-identical to current).
2. **Drop §4.2** (`crossTabChip`/`lastExitChip` latch). Wrong branch, not branch-agnostic, and a shared-primitive leak.
3. **Drop §4.4** (settle-driven back-to-tab). Unnecessary: a `transform` CSS transition runs on the compositor thread once started, so the headless three-frame main-thread block (caused by `slideT='none'`, not by a dropped transition) does not produce a partial snap once the transition is enabled. Enabling the transition fixes both the jump and the freeze-then-jump.
4. **Files shrink to one**: only `Header.svelte` changes (the `slideT` term). `navigation.svelte.ts`, `navigation-logic.ts`, `GesturePageLayout.svelte` unchanged.
5. **Fix all citation drift.**
6. **Empirical gate**: run the full e2e suite (gesture `header-tabs-replay`, same-panel `tab-exit-preview`, cross-tab, deep→deep `header-title-crossfade-clip`, root-search `search-enter-exit-asymmetry`, forward, `swipe-back-pill-flicker`, `enter-animation`) with the term removed; all must stay green. This is the §4.3-vs-Variant-B decider.
7. **Note the Auditor 5 Variant B disagreement** explicitly in the plan, with the `runSettleDriver` single-jump evidence and the empirical gate.

Round 2 audit will re-verify the revised plan (single-term removal, Header-local, branch-agnostic) plus the empirical-gate reasoning.

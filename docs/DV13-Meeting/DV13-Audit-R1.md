# DV13 - Audit Round 1

5 independent role-less auditors examined `docs/DV13-Plan.md` against the codebase at `master` (post-DV12 `cee9142`). Result: **4/5 PASS, 1/5 has-special-cases** (auditor 3, medium confidence). Not a loop exit (DV09 standard is 5/5 unconditional PASS). The fix expression itself is unanimously endorsed; the dissent is on the plan's ANALYSIS TEXT (the gesture-path claim and the intermittency mechanism), not the fix.

## Tally

| Auditor | Verdict           | Blocking | Concerns | Organic | Confidence |
| ------- | ----------------- | -------- | -------- | ------- | ---------- |
| 1       | PASS              | 0        | 0        | clean   | high       |
| 2       | PASS              | 0        | 3        | clean   | high       |
| 3       | has-special-cases | 0        | 6        | clean   | medium     |
| 4       | PASS              | 0        | 5        | clean   | high       |
| 5       | PASS              | 0        | 6        | clean   | high       |

## Convergent endorsement (all 5)

- The fix `iconProgress = $derived(isSearch || searchScrubbing ? 0 : 1 - morph)` is correct for the `/search` -> `/` tap / popstate defect path. Verified at `Header.svelte:192`, `morph` branch 1b at `:150-153`, Effect E at `:378-402`, `startSearchScrub` at `:404-427`.
- Both terms are load-bearing: `isSearch` freezes the icon at search-mode rest (where `morph = 0` -> `1 - morph = 1` = arrow, wrong); `searchScrubbing` freezes it during the scrub transition (the defect).
- `iconProgress` has exactly one consumer (`<BurgerArrowIcon>` at `Header.svelte:769`); the atom is pure presentation; no reactive feedback into `morph` or `searchScrubbing`.
- The `searchScrubbing` discriminant is already used by `slideT` (`:203-205`), `trackStyle` (`:595`), `searchButtonStyle` (`:607`), `tabBarStyle` (`:614`) for the same semantic. The fix aligns `iconProgress` with established prior art.
- `searchScrubbing` is set true ONLY by `startSearchScrub`, called ONLY from Effect E, which fires ONLY on a `currentHasTabs` flip paired with an `isSearch` flip. Root<->deep never coincides with a scrub; the freeze cannot over-fire on the icon's actual domain.
- §6.3 rejections (freeze on `morph === 0`; drop `isSearch`; separate `deepMorph` signal) are all sound.
- Organic integration: clean. One expression + its comment; no new token, state, effect, prop, or file; no shared primitive touched.

## Analysis-text defects raised by auditor 3 (non-blocking for the fix, blocking for plan approval)

**A1 - §3 / §8.4 gesture-path claim is statically disputed.** The plan claims a gesture back-swipe from `/search` does NOT enter `startSearchScrub` (Effect E's `dragging` guard at `:398`). Auditor 3 traced that at the gesture-landing flush `dragging` is already false and (if Effect D clears `settling` before Effect E reads it) Effect E would fire the scrub, which would also jump `morph` 1 -> 0 -> 1 and visibly defect `rootLayerStyle` / `searchProgress`. Auditor 3 flagged this as statically uncertain (`$effect.pre` ordering between D and E is not guaranteed) and asked for empirical confirmation.

**A2 - §4 intermittency mechanism is statically false.** The plan claims the initial hard load of `/` arms a deep-title settle via Effect C's idle branch. Auditor 3 traced that `/` has `title === ''` (no `headerTitle`, `/` absent from `deep-header-config.ts`), so Effect C's idle branch takes `else if (!newTitle && !isDeep)` and arms NO settle. The empirical `0.0, 180, 180, 180, 180` signature is real but the plan's stated cause does not match Effect C's logic for `/`.

## Empirical resolution (this round, via DV12's committed `window.__headerMorphProbe`)

A throwaway diagnostic (deleted after) drove both cases against the probe. Results settle A1 and A2 definitively:

- **A1 RESOLVED: the gesture path does NOT fire the scrub.** A CDP touch back-swipe `/search` -> `/` shows `min morph on / after landing = 1.000`. The gesture's commit settle (armed by Effect B at release, `settling = true`, `pendingNav = '/'`) drives `morph` 0.57 -> 1.00 via branch 2 and HOLDS `settling = true` through the landing flush (Effect D ends the settle on nav-done, but in that same flush Effect E reads `settling === true` via untrack at `:399` and returns early). The scrub never fires; `morph` never dips after landing; there is no `rootLayerStyle` jump. Auditor 3's concern-3 (pre-existing morph-jump on gesture landing) is empirically refuted. The plan's §3 / §8.4 claim was correct; it is promoted from §11 UNVERIFIED to verified-with-evidence.

- **A2 RESOLVED: the mask IS `settling`; the exact arm-path is a lingering commit settle, not the title idle branch.** The probe shows iteration 0 has `settling = true` (`sp` 0 -> 1, `pendingNav = '/'`) at the back moment, iterations 1+ have `settling = false` (the scrub fires and `morph` scrubs 0 -> 0.78). Auditor 3 is correct that the title idle branch does not arm the settle for `/`. The settle on iteration 0 is a commit settle lingering from the initial-load / first-forward-nav sequencing; the plan's §4 mechanism is corrected to match the observation. The fix's conclusion (the intermittency is moot once `iconProgress` is frozen) is unchanged.

## Notable concerns (non-blocking, to fold into the revision)

- **C1 - parenthesization (auditor 5).** `isSearch || searchScrubbing ? 0 : 1 - morph` parses as `(isSearch || searchScrubbing) ? 0 : (1 - morph)` (verified), but the bare form invites a future misread as `isSearch || (searchScrubbing ? 0 : 1 - morph)`. Add explicit parens to match `slideT`'s style at `:203-205`.
- **C2 - desktop rationale imprecise (auditor 4).** The plan says desktop has "no search scrub interaction". Effect E / `startSearchScrub` are viewport-agnostic; the scrub DOES arm on desktop. The fix is a desktop no-op because `BurgerArrowIcon` lives inside the `md:hidden` mobile block (`Header.svelte:758`), not because the scrub is absent. Correct the rationale.
- **C3 - audit-gate enumeration (auditor 5).** DV09's §7 enumerates per-file `git diff --` gates; DV13's §9 is single-target. Acceptable given the diff is one expression in one file; add a one-line note that the diff is provably single-target by grep.
- **C4 - `$derived` vs `$derived.by` (auditor 5).** Confirmed `$derived` is correct (single ternary, no statement / side-effect / closure); `morph` and `isSettleMode` use `$derived.by` only for multi-statement bodies. No change; record the reasoning.

## Revision decisions

1. **§3 / §8.4 / §11 - promote the gesture-path claim to empirically verified.** Add the Q1 evidence (`min morph on / after gesture landing = 1.000`; the commit settle holds `settling = true` through landing, blocking Effect E). Move gesture from §11 UNVERIFIED to a "Verified" note.
2. **§4 - correct the intermittency mechanism.** Replace "the title idle branch latches `settling`" with "a commit settle (`pendingNav = '/'`, `settleAwaitTitle`) lingers from the initial-load / first-forward-nav sequencing on iteration 0; iterations 1+ have no settle at the back, so the scrub fires. Empirically confirmed: iter 0 `settling = true`, iter 1+ `settling = false`." The conclusion (the mask is moot post-fix) is unchanged.
3. **§6.1 - parenthesize the fix.** `const iconProgress = $derived((isSearch || searchScrubbing) ? 0 : 1 - morph);`.
4. **§10 - correct the desktop rationale.** The fix is a desktop no-op because `BurgerArrowIcon` is inside the `md:hidden` mobile block; the scrub itself is viewport-agnostic.
5. **§9 - add the single-target audit-gate note** (grep proves `iconProgress` has one consumer; the diff is one expression in one file).

The fix expression is unchanged from Round 1 (all 5 auditors endorsed it); only the plan's explanatory text and the parenthesization change. Round 2 re-audits the revised plan.

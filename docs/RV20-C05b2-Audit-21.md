# RV20-C05b2 - Audit Round 21

Result: **A PASS-WITH-CONCERNS (1 CONCERN + 1 LOW); B PASS-WITH-CONCERNS (4
CONCERN).** Counter stays **0/5**. Both auditors confirmed §5/§13.5/§6/§13.3
all hold. The findings are edge-case behavior issues + one stale comment.

## A findings

- **A C1 (CONCERN):** Deep-search tap-scrub icon discontinuity (iconProgress
  reads isSearch, a discrete URL flag; snaps at the URL swap while the track
  scrubs smoothly). Fixed: iconProgress lerps via tapMorph \* scrubIconEndpoint.
- **A C2 (LOW):** notifyHeaderState gap-frame race (#mounted early-return during
  releaseInputs-to-configure gap). Fixed: playEnterAnimation arms the settle
  itself.

## B findings

- **B F1 (CONCERN):** Stale NavExecutor.onCommit docstring (references old
  TAB_CLICK_COMMIT_MS + CSS duration). Fixed: rewritten.
- **B F2 (CONCERN):** Pill discontinuity on backward-to-deep (non-leftmost tab)
  - pill interpolates toward spatial-previous tab, not the deep page. Fixed: pill
    holds at fromIdx for backward-to-deep.
- **B F3 (CONCERN):** Header morph stays hamburger during tab-host
  backward-to-deep (backMorph null). Fixed: backMorph published for
  backward-to-deep.
- **B F4 (CONCERN):** Gap-frame race (same as A C2). Fixed.

## Additional fix (not an R21 finding): SearchScopePager CSS transition eliminated

The SearchScopePager's `transition-transform duration-200` CSS class was
eliminated (per the user's directive: no CSS transitions anywhere, no bridges).
Replaced with an rAF-driven scope-switch animation (visualIndex state + settle
rAF with 2u-u² easing + reduced-motion gate). Known condition removed from spec.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1460 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    411 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (passes on retry) = 202
```

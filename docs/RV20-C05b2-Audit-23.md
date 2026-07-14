# RV20-C05b2 - Audit Round 23

Result: **A PASS-WITH-CONCERNS (1 CONCERN + 1 NITPICK); B PASS-WITH-CONCERNS
(2 CONCERN + 1 documented).** Counter stays **0/5**. Both auditors confirmed:
"No empirically demonstrable defect in the live pipeline. §5/§13.5/§6/§13.3 all
hold." The findings are a fragile invariant, a stale comment, and dead code.

## A findings

- **A F1 (CONCERN):** Cancel settle ease used hardcoded `TITLE_CROSSFADE_MS`
  (200ms) instead of the velocity-matched `commitDurationMs`. The cancel slide IS
  velocity-matched, so the settle should use the same duration. Fixed: both commit
  and cancel branches now use `commitDurationMs`.
- **A F2 (NITPICK):** Stale comment at the commit-settle arm call site ("over
  `TITLE_CROSSFADE_MS`" — actually uses `commitDurationMs`). Fixed.

## B findings

- **B F1 (CONCERN):** `#headerT = t` assignment ran after the `!#mounted` guard,
  so gap-frame calls didn't update it. Fragile but not reachable in normal flow.
  Fixed: hoisted above the guard.
- **B F2 (CONCERN):** `MobileTabPager.svelte` and `GesturePageLayout.svelte`
  contained CSS transitions + setTimeout (dead code, zero imports). Fixed: both
  files deleted.
- **B F3 (documented):** The 5 Known conditions are spec-disclosed deviations
  with 5b3 resolution paths.

## Gate outputs (post-fix)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    411 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky = 202
```

R24 audits the post-fix state. R24 auditors were launched but both hit the 5-hour
API rate limit; they must be re-launched after the limit resets (2026-07-14
19:03).

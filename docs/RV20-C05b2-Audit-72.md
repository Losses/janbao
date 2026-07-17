# RV20-C05b2 - Audit Round 72

Result: **A PASS-WITH-CONCERNS (1 CONCERN, logic); B PASS-WITH-CONCERNS (2
CONCERN, 1 dead code + 1 logic).** Counter stays **0/5**. R72 found the
forward-direction within-tab pagination gesture gap (A1), a dead-state flag that
R68 B1's #endSettleEase clear had made unreachable (B1), and a stale
header-state across AppShell unmount/remount (B2). All fixed.

## A's finding

1. **Forward-direction within-tab pagination gesture not suppressed (LOGIC,
   FIXED).** R69 A1 fixed the backward direction (`/discussions/pN` -> `/`),
   but the forward direction (`/` -> `/discussions/pN` via back-swipe) was not
   suppressed because `suppressSlide` compared `fromTabIndex === toTabIndex`
   where `toTabIndex = #tabIndexFor(toPathname)` returns -1 for `/discussions/pN`
   (not a tab root). Fixed: replaced `toTabIndex` with `getCurrentTabIndex(toPathname)`
   (pill-target-based, returns 0 for `/discussions/pN`), so both directions are
   suppressed.

## B's findings

1. **`#enterAnimationArmedSettle` is dead state (DEAD CODE, FIXED).** The flag's
   idle-branch read was unreachable: `#endSettleEase` (R68 B1) clears the flag
   before `settleActive` becomes false, so the idle branch's
   `if (#enterAnimationArmedSettle)` is always false. Removed the flag entirely
   (declaration, set in `playEnterAnimation`, all clears in `#armSettleEase` /
   mid-settle / `#endSettleEase` / `releaseInputs` / `unmount`, and the
   idle-branch read). The idle branch now always arms (correct: the morph is
   continuous because `outgoingHasTabs === incomingHasTabs` for a same-route
   title resolution).
2. **Stale header-state across AppShell unmount/remount (LOGIC, FIXED).** When
   the user navigates to `/entry/*` (login/logout), AppShell unmounts, the
   Header unmounts, `notifyHeaderState` doesn't fire, and
   `#headerStateInitialized` stays `true`. On AppShell remount, the first
   `notifyHeaderState` takes the main body (skipping init), arming a settle
   with stale prev values (brief ~200ms stale-title + back-arrow glitch). Fixed:
   added `resetHeaderState()` to the orchestrator; the Header's `onMount` calls
   it (onMount fires only on a fresh Header instance: initial load + AppShell
   remount, not pipeline route swaps).

## Gate outputs (post-fix, independently re-run 2026-07-17)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    378 pass / 0 fail
$ bun run test:e2e                    202 passed + 2 flaky (exit 0)
```

R73 audits this state.

# RV21-C01 Audit 41 (R41)

**Date:** 2026-07-30. **Round:** R41. **Votes:** auditor A PASS, auditor
B BLOCK. **Counter after:** 0/5.

## Auditor B findings (CONFIRMED)

**F1:** `e2e/messages-back-swipe.spec.ts:2412` FAB disagreement "~0.4".
Actual is `0.88 - 0.4 = 0.48` (the same test's inline comment at
L2443-2445 states both values precisely). Fixed `~0.4` -> `~0.48`.

**F2:** `e2e/search-back-hamburger-flash.spec.ts:51` trackTx docstring
"scrub drove `morph`". The scrub drives `searchProgress` / `trackMorph`
(the search track); the vertical `morph` derivation explicitly excludes
the search scrub (Header.svelte:156). Fixed to "scrub drove the search
track".

**F3:** `orchestrator:4189` "the enter slide's `backMorph` drives the
morph". This contradicts `playEnterAnimation` (L1187: "morph NOT driven
by `backMorph` ... driven by the settle ease"); during the enter
`dragging` is false, so the morph $derived reads the settle branch.
Reworded: the enter settle ease drives the morph; `backMorph` drives the
search axis.

## Verify

`bun run check` 0/0; `bun run lint` exit 0; prettier + em-dash clean on
all three edited files. Comment-only; runtime unchanged.

## Disposition

Counter after R41: 0/5.

# RV21-C01 Audit 30 (R30)

**Date:** 2026-07-29. **Round:** R30. **Votes:** auditor A PASS, auditor
B BLOCK. **Counter after:** 0/5 (one BLOCK resets the convergence
counter).

Two independent fresh-context auditors were spawned with the standard
DV21-C01-Audit-Prompt (no prior-round context, no mechanism hints, open
"find ANY defect" instruction). Summary of their reports.

## Auditor A: PASS

Re-ran `bun run check` (0/0), `bun run lint` (exit 0), `bun test src/lib`
(552 pass), the R28 targeted guard (1 passed, max 24.05px < 30px), and
em-dash / prettier greps on the five touched files. Verified the R29
fix at orchestrator L4386 (`startProgress * viewport-width`, no
`* 50%`). Re-derived the px-per-searchProgress factor from the DOM
geometry (factor 1.0). Sibling search scoped to `src/lib`
snap-magnitude claims and "N-branch" / "N reach paths" counts; all
correct. Voted PASS (1/5).

## Auditor B: BLOCK

Same verification baseline. Found that R29's sibling search was scoped
to `src/lib/{stores,components,utils}` and missed the same factor-of-2
root cause in `e2e/`. Reported four in-scope code-comment concerns (all
`.spec.ts` / `.ts`, all factor-of-2 understatements of the header
root-to-search track translate):

1. `e2e/messages-back-swipe.spec.ts:3214` (R23-B F1): `bm * viewport/2`
   contradicts its own ~168px (`0.43 * 393 = 169`, not 84).
2. `e2e/messages-back-swipe.spec.ts:3284` (R23-B F2): `~viewport/2,
~196px` contradicts `header-probe.ts:189` (~393px) for the same
   defect.
3. `e2e/messages-back-swipe.spec.ts:3586` (R28): `anchor.raw * 50% *
viewport-width`, identical to the R29 F1 inaccuracy.
4. `e2e/helpers.ts:863` (hdrTrackTx signal doc): `~-viewport/2` should
   be `~-viewport-width` (the R29 probe measured -393px at /search on a
   393px viewport).

Voted BLOCK.

## Orchestrator independent sibling check (binding)

Auditor B's sibling grep phrasings (`viewport/2 | panel.*half`) missed
the `half-viewport` hyphenated form. The orchestrator re-ran a broader
grep and found two more siblings of site 4:

5. `e2e/search-back-hamburger-flash.spec.ts:50`: trackTx signal doc
   `~-half-viewport` -> `~-viewport-width`.
6. `e2e/search-enter-exit-asymmetry.spec.ts:48`: trackTx signal doc
   `~-half-viewport` -> `~-viewport-width`.

All other `half` / `50%` / `viewport` hits in `e2e/` were classified as
legitimate (FAB half-mapping curve comments, finger-drag half
distances, the page-track `translateX(-50%)` SSR rest on the 3-panel
track, correct "full viewport width" magnitude claims). The six sites
are the complete factor-of-2 set for the header root-to-search track.

## Disposition

All six fixed this round (see the R30 fix journal entry). Counter after
R30: 0/5.

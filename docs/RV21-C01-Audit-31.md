# RV21-C01 Audit 31 (R31)

**Date:** 2026-07-29. **Round:** R31. **Votes:** auditor A PASS, auditor
B PASS. **Counter after:** 1/5 (first clean round after the R30 BLOCK).

Two independent fresh-context auditors, standard prompt, no prior-round
context. Both verified the R30 six-site fix and swept the whole layer.

## What both auditors verified

- The six R30 e2e factor-of-2 corrections are in place at factor 1.0
  (`viewport-width`).
- Re-derived the px-per-searchProgress factor from the DOM geometry
  (`translateX(-(searchProgress * 50)%)` of the `w-[200%]` element nets
  to `searchProgress * viewport-width`, factor 1.0). Matches every CODE
  snap-magnitude claim.
- Broad sibling grep (`half | viewport/2 | half-viewport | 50% | 0.5 |
~196 | ~393 | px snap | px on a`) across `src/lib` + `e2e/`: every
  remaining hit is legitimate (FAB half-mapping curve, finger-drag half
  distances, the page-track `translateX(-50%)` rest on the 3-panel
  track, `PILL_EXPANSION_THRESHOLD = 0.5`, the `(searchProgress * 0.5)`
  0.5rem search-button inset). No factor-of-2 CODE-comment defect
  remains.
- Reach-path / branch counts re-checked: `#searchAnchor` 4 seed sites,
  `#enterFabAnchor` 5 seed sites, Header `searchProgress` five-branch,
  `computeFabScale` five-branch. All accurate.
- §5 invariant: no CSS transition or animation-driving `setTimeout` in
  the gesture/header/search animation layer.
- Baseline gates green (`bun run check` 0/0, `bun run lint` exit 0,
  `bun test src/lib` 552 pass, the R23-B F1/F2 + R24-A + R26-A + R28
  continuity guards all under the 30px threshold).

## Out-of-scope observation (auditor B, `.md` nitpick, does NOT block)

The journal's R23-B entry still carries the old factor-of-2 phrasing in
its prose (the R29/R30 fixes corrected the current code, not the
historical journal text):

- `Journal:4625` `-bm * viewport/2`
- `Journal:4635` `~viewport/2 out and ~viewport/2 back in`
- `Journal:4744` / `Journal:4981` `196.5px half-viewport` (the eased-step
  base for the ~20px post-fix cadence)
- `Journal:4745` `bm * viewport/2 (bm=0.60)` (auditor B notes bm should
  be ~0.30: the measured 117.98px = `0.30 * 393`, factor 1.0; `0.60 *
196.5` is factor 0.5)

These are `.md`-only (journal prose), classified nitpick, do not reset
the counter. Orchestrator disposition: left as historical record. The
R23-B entry documents that round's measurements and derivation; the
`4744`/`4981` eased-step base (196.5px) is not a simple factor typo and
was not re-derived this round, so a partial rewrite risks introducing a
new inaccuracy. The current code (src/lib + e2e) is fully factor-1.0.

## Disposition

No code change this round (double PASS). Counter after R31: 1/5.

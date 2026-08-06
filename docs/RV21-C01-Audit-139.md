# RV21-C01 Audit 139 (R139)

**Date:** 2026-08-06. **Round:** R139. **Votes:** A BLOCK, B BLOCK. **Counter: 0/5.**

Six loose-vs-strict pill-mapping conflation sites (same class as R137 F1 / R138).
All fixed: replaced loose "pill-map"/"tab-to-tab" with accurate "resolve to a tab"
(strict `#tabIndexFor` / `tag: 'tab'`), removed `/offline/bookmarks` from null-case
lists (its back-target `/offline` is `tag: 'tab'` but not a strict tab root, so
backMorph is raw, not null). Both auditors verified the R137 F1 runtime fix is correct.

Sites: e2e/reproduce-dv20-drag-sync:97, orchestrator:4490/4723/4753/4824, Header:258.

`bun run check` 0/0; prettier clean; no U+2014; 398/0. **No git mutation.**

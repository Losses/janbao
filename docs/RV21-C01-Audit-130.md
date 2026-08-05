# RV21-C01 Audit 130 (R130)

**Date:** 2026-08-05. **Round:** R130. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

The largest round yet: 12 defects across the MIRROR of the R129-B class
plus an e2e universal. Counter stays 0/5.

## Sub-class A (11 sites) -- positive "thread"-only characterizations of centerTab-branch behavior

R129-B fixed the sites that placed compose in the NON-centerTab bucket.
R130-A found the mirror: positive characterizations of centerTab-branch
behavior labeled "thread" alone, when compose (also a centerTab route)
exercises the same behavior. Compose routes set `centerTab` (R129
verified), so the `centerTab !== undefined` branch, the
`#dragMorphAtSettleTakeover(isCenterTabRoute=true)` shape, the at-rest
publication, and the case-2 settle-arm all fire for compose exactly as
for thread.

Fixed 11 sites by broadening "thread" → "centerTab route" (or
"thread/compose"):

- `orchestrator:264` "the thread overlays"; `:2713, :2854, :2988, :3618`
  "centerTab thread -> tab-root" (the drag-morph shape list);
  `:4530` "Thread route: the pill stays on centerTab at rest";
  `:4535` "the thread route"; `:4605` "(thread detail pages)".
- `mobile-pager.svelte.ts:18` "tab roots and threads"; `:34`
  "A centerTab thread -> tab-root".
- `Header.svelte:218` "A centerTab thread -> tab-root" (parallel to the
  R129 fix at :214 in the same block).

Header.svelte:207 ("deep page, compose, and centerTab threads alike")
and the e2e "enter thread detail" test-step descriptions were verified
accurate and left unchanged.

## Sub-class B (1 site) -- e2e universal drops the offline LIST qualifier

`e2e/reproduce-dv20-drag-sync.spec.ts:95-96` stated "publishes a live
`backMorph` for every claimed drag on a NavPipelineHost route (deep page,
compose, and centerTab threads alike)" -- a universal the Header version
(206-217) qualifies with "the only null publication is ... NavPipelineHost
offline LIST routes." For `/offline` → `/` both endpoints pill-map to
discussions, so the non-centerTab branch's `(fromIdx >= 0 && toIdx >= 0)`
clause nulls `backMorph`. The e2e copy dropped the qualifier, leaving a
wrong universal. Fixed by adding "whose endpoints do not both pill-map to a
tab (...; the offline LIST mirror routes ... null `backMorph` end to end)."

## Why R129 missed these

R129 swept the NEGATIVE "non-centerTab" / "When undefined" / null-condition
sites. R130's mirror class is the POSITIVE "thread" characterizations of
the centerTab branch -- a different lexical neighborhood
("centerTab thread ->", "Thread route:", "the thread overlays", "thread
detail pages") that R129 did not grep. Each polarity (negative/positive)
needs its own sweep.

## Verify

`bun run check` 0/0; `prettier --check` clean on all 4 edited files; no
U+2014 em-dash; comment-only changes. Re-grep confirms no stray
"centerTab thread ->" / "Thread route:" shape references remain.

## Disposition

Counter after R130: 0/5. 12 defects this round (the most yet). The
"thread vs centerTab route" terminology over-narrowness is pervasive, and
each round's sweep of a new polarity/neighborhood surfaces a fresh batch.
At the strict bar the tail is long.

**No git mutation.** No commits, no branches, no pushes.

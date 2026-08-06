# RV21-C01 Audit 135 (R135)

**Date:** 2026-08-05. **Round:** R135. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

Three confirmed defects, all genuine: one route mis-classification (A) and
two value-mapping parentheticals omitting the offline-LIST-mirror case (B,
both in parentheticals R131/R133 had partially fixed). Counter 0/5.

## A -- `orchestrator:2555` (within-tab-pagination guard comment)

The guard comment called `/discussion/<id>` (a centerTab thread,
`hasTabs === true`) a "DEEP route," and named the category "DEEP route that
shares the tab's index" -- which is empty (real deep routes `/profile`,
`/bookmarks` have `getCurrentTabIndex === -1`, failing the guard's first
clause; the branch actually protects centerTab threads/compose + offline
LIST detail mirrors). Fixed: "a non-tab-root route that shares the tab's
pill index (e.g. `/discussion/<id>` -> `/`, a centerTab thread returning to
its tab root)."

## B -- two value-mapping parentheticals omitting offline LIST mirrors

Offline LIST mirror routes (`/offline`, `/offline/activity`, `/offline/bookmarks`)
have a mount-time `fromTabIndex` / landing `fractionalIndex` equal to the
pill index (e.g. 0 for `/offline`), distinct from `centerTab` (thread/compose)
and `-1` (deep pages). Two value-mapping parentheticals enumerated only the
latter two:

- `orchestrator:4605` (`updateFromPathname`, R133's fix site): "(the
  `centerTab` for thread/compose routes, -1 for deep pages)" -> added
  "the pill index for offline LIST mirrors."
- `orchestrator:4716` (`#republishToPager` Tab-host Backward-to-deep-page,
  R131's fix site): "(`centerTab` for a thread or compose route, -1 for a
  deep page)" -> added "the pill index for an offline LIST mirror."

These are value-mappings (claim specific values by route type), so omitting
offline LIST's distinct pill-index value is a genuine non-exhaustive
enumeration -- not the illustrative route-TYPE-list class that is defensible.

## Verify

`bun run check` 0/0; `prettier --check` clean; no U+2014 em-dash;
comment-only changes.

## Disposition

Counter after R135: 0/5. The offline-LIST-pill-index value is a distinct
third case that the value-mapping parentheticals must enumerate (R134 fixed
the `#republishToPager` Deep-page-mode sub-cases; R135 fixed the
`updateFromPathname` and Tab-host Backward-to-deep sites). With these, the
value-mapping parentheticals across the layer should now cover all three
route-shape values.

**No git mutation.** No commits, no branches, no pushes.

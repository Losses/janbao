# RV21-C01 Audit 131 (R131)

**Date:** 2026-08-05. **Round:** R131. **Votes:** auditor A BLOCK,
auditor B BLOCK. **Counter after: 0/5.**

## Outcome

A found 10, B found 3 (overlap on 2). The orchestrator independently
verified each against the code: **4 confirmed defects fixed**, **7 rejected
as verified non-defects** (auditor enumerations are not trusted; each
finding is re-derived against the code).

## Confirmed and fixed (4)

**Class 1 -- "thread" residuals of R130-A (3 sites):** compose is a
centerTab route, so it exercises the centerTab-branch behaviors that these
comments labeled "thread" alone.

- `orchestrator:4682` -- `#republishToPager` docstring mode title "Thread
  mode (centerTab set)" -> "centerTab mode (centerTab set)".
- `orchestrator:4716` -- Tab-host Backward-to-deep parenthetical
  "(`centerTab` for a thread, -1 for a deep page)" misses compose (a
  compose landing also publishes `centerTab`). -> "for a thread or compose
  route".
- `e2e/search-enter-exit-asymmetry.spec.ts:55-56` -- "null at rest on a
  thread/tab host" misses compose. -> "centerTab route or a tab host".

**F3 -- R130-B regression (1 site):** `e2e/reproduce-dv20-drag-sync:95-99`.
R130-B's qualifier "whose endpoints do not both pill-map to a tab" was
wrong -- centerTab routes' endpoints DO both pill-map (e.g.
`/discussion/<id>` and `/` both pill-map to discussions) yet they publish
`backMorph` via the centerTab branch, so the qualifier contradicted the
parenthetical that lists them. Rewrote to match the Header framing: "for
every claimed drag on a NavPipelineHost route (deep page, compose, and
centerTab threads alike) except a non-centerTab tab-to-tab swipe (the
offline LIST mirror routes null `backMorph`)."

## Rejected as verified non-defects (7 -- auditor A's "Class 2")

A flagged 7 compact "tab-to-tab on a non-centerTab host" phrases
(orchestrator:4474, 2715, 2992, 3466, 3474; Header:258, 592) as needing
the offline LIST host-type enumeration. The orchestrator verified these
are ACCURATE as written: the codebase's null-`backMorph` condition is
`(fromIdx >= 0 && toIdx >= 0)` -- i.e. "tab-to-tab" means _both endpoints
pill-map to tabs_, which the offline LIST routes (`/offline` -> `/`, both
pill-map to discussions) satisfy. So "tab-to-tab on a non-centerTab host"
accurately INCLUDES the offline LIST case (it is an instance of the shape,
not excluded). Auditor B concurred (did not flag any of the 7). The
canonical sites (mobile-pager:27-31, Header:210-217, orchestrator:4807-4813,
3606-3608) spell out the host types for clarity, but the compact phrase is
not inaccurate. Rejected.

## Note on the convergence trajectory

R129=8, R130=12, R131=10 findings (4 confirmed). The over-narrow /
route-classification tail is long: each round's sweep of a new polarity or
neighborhood surfaces a fresh batch. The orchestrator now applies
independent verification (rejecting over-reaches) to keep the fix set to
genuine inaccuracies. Counter remains 0/5.

## Verify

`bun run check` 0/0; `prettier --check` clean on all 3 edited files; no
U+2014 em-dash; comment-only changes.

**No git mutation.** No commits, no branches, no pushes.

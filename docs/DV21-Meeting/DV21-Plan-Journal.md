# DV21 Plan Journal

Revision and audit history for `docs/DV21-Plan.md`. Per the
revision-goes-in-the-meeting-journal convention, plan-level changes are recorded
here, not in the plan itself. Cycle-level implementation history lives in
`docs/DV21-Meeting/DV21-C01-Journal.md`; per-round audit reports in
`docs/RV21-C01-Audit-NN.md`.

## Session 0 (setup, 2026-07-25)

Opened DV21 after five DV20-layer runtime regressions were reproduced
empirically (bugs 1, 3, 4, 6, 7; see the auto-memory note
`dv20-refactor-regressions-e2e.md` and the specs
`e2e/reproduce-dv20-drag-sync.spec.ts`, `e2e/reproduce-dv20-search-swipe.spec.ts`).
The DV20 convergence (C05b2 / C05c3 / C06, 5/5) judged architectural cleanliness,
not runtime UX behaviour; these survived that bar.

Wrote `docs/DV21-Plan.md` (macro plan, one cycle), the Cycle 1 spec
`docs/DV21-Meeting/DV21-C01-spec.md`, and the audit prompt
`docs/DV21-Meeting/DV21-C01-Audit-Prompt.md` (open-scoped, non-leading, per the
2026-07-19 orient-don't-scope feedback). Reuses
`docs/DV20-Meeting/DV20-Cycle-Manager-Protocol-v2.md` (version-stable).

Bug 2 (commit-slide feel) and bug 5 (rightward boundary Activity highlight) are
NOT reproduced on master and stay as regression guards, not DV21 work.

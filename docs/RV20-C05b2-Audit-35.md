# RV20-C05b2 - Audit Round 35

Result: **A PASS-WITH-CONCERNS (1 CONCERN + 1 nitpick); B PASS-WITH-CONCERNS (1
CONCERN).** Counter stays **0/5**. Two comment-accuracy concerns, both fixed.
No logic defect. A also independently verified the R34 deep-to-deep handshake
(`#lastDispatchWasDeepToDeep`) timing is correct.

## Findings

### A1 (CONCERN, fixed) - isNavPipelineRoute JSDoc omitted a compose route

`nav-pipeline-gate.ts:30` listed the compose routes as `/post/discussion`,
`/messages/new` but the code (line 52) also matches `/messages/add/[userId]`, and
the "not listed here does not mount a pipeline host" line implied an exhaustive
list. Fixed: the comment now lists all three compose routes.

### B1 (CONCERN, fixed) - cancel settle "velocity-matched" overstatement

Two comments (`orchestrator:1214-1216`, `#armSettleEaseFromGesture` docstring
2288-2296) claimed the cancel slide's settle ease runs over a "velocity-matched"
duration. For a typical cancel (drag-direction release velocity) the solver
returns `COMMIT_T_DEFAULT_MS` (300ms); only a reversed-direction cancel yields a
velocity-matched duration (confirmed by `nav-executor-logic.test.ts:275-284`).
Fixed: both comments now state the cancel duration is the solver-computed value
(velocity-matched for a reversed release, `COMMIT_T_DEFAULT_MS` for a
drag-direction release).

### A nitpick (`.md`, fixed)

Spec "Phased approach" step 4 said "2 routes" for the compose migration while
"Routes to migrate" lists three. Corrected to 3 routes (`/post/discussion`,
`/messages/new`, `/messages/add/[userId]`).

## Open item (pending user decision)

The `snippet` field in the cache entry shape (`page-cache-svelte-types.ts`) is
write-only in production (its reader, the deleted `MobileTabPager`, is gone).
DV20-Plan section 7 lists it, but section 7's description ("a render closure for
deep pages that capture one") matches the deleted MobileTabPager preview
mechanism, so section 7 is likely stale and the field is likely dead code. R34
retained it per section 7 (treating the section as authoritative); the cleaner
resolution - delete the field and update section 7 - is pending the user's
decision (it touches the spec's binding entry-shape description).

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    409 pass / 0 fail
$ bun run test:e2e                    202 passed + 1 flaky (fab.spec.ts:432,
                                     the pre-existing CDP touch flake)
```

All fixes are comment/doc-only; e2e confirms no regression.

R36 audits the post-R35-fix state.

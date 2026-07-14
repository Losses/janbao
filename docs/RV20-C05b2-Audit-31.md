# RV20-C05b2 - Audit Round 31

Result: **A PASS-WITH-CONCERNS (1 CONCERN); B PASS-WITH-CONCERNS (1 CONCERN).**
Counter stays **0/5**. Two comment-accuracy concerns, both fixed. No logic
defect.

## Findings

### A1 (CONCERN) - #computeFabRestingScale docstring contradicts the code

`nav-pipeline-orchestrator.svelte.ts:2020-2025` docstring claimed "at rest on
/activity the resolved kind is whichever list FAB sits at the published
fractional index (typically messages at index 1)". The code returns 0 (no FAB)
at rest: `#listFabTabIndex`'s dynamic branch returns null when the fractional
index is exactly 1 (activity's rest position), so `#computeFabRestingScale`
returns 0. The inline comment in `#listFabTabIndex` (lines 2097-2101) already
stated this correctly; the outer docstring disagreed, and "messages at index 1"
also misidentified the tab (messages is index 2). Fixed: the docstring now
matches the inline comment (at rest, index 1, no FAB, scale 0; off-rest, the
index dips toward 0 (discussions) or rises toward 2 (messages)).

### B1 (CONCERN) - garbled invalidate docstring

`page-cache.svelte.ts:113-114` had a duplicated sentence with a stray mid-line
`/**` opener (a botched edit boundary from the R24 `getLatestWithSnippet`
deletion; prettier/eslint do not parse JSDoc content so it slipped through).
Fixed: restored the single clean docstring.

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    409 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:430,
                                     the pre-existing CDP touch flake)
```

Both fixes are comment-only (no behavioral change); e2e confirms no regression.

R32 audits the post-R31-fix state.

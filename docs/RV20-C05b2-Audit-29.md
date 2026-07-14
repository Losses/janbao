# RV20-C05b2 - Audit Round 29

Result: **A PASS-WITH-CONCERNS (2 CONCERN + 1 nitpick); B PASS-WITH-CONCERNS (1
CONCERN).** Counter stays **0/5**. Three concerns; one is a real logic defect
(B1). The finding count is down sharply from R28's thirteen.

## Findings

### B1 (CONCERN, medium, logic defect) - non-pipeline detail targets intercepted

`onSvelteKitBeforeNavigate` gated deep-to-deep interception on
`fromTag === 'detail' && toTag === 'detail'` but never checked
`isNavPipelineRoute(to)`. Unmatched pathnames fall through to `DEFAULT_ROUTE_DATA`
(`tag: 'detail'`), so the orchestrator intercepted EVERY detail->detail nav from
a pipeline route, including non-pipeline targets (`/entry/signout`,
`/categories`, `/drafts`, `/offline/*`). The user saw an unwanted ~300ms skeleton
slide (e.g. tapping Sign Out on `/profile`) before the plain page appeared.

Fixed: `isDeepToDeep` (renamed from `isForwardDeepToDeep`) now also requires
`isNavPipelineRoute(to)`; non-pipeline detail targets return false from the guard
and pass through to plain SvelteKit navigation. (`isNavPipelineRoute` was already
imported, used post-slide at `#onExecutorSettle`.)

### A1 (CONCERN, naming + metadata) - isForwardDeepToDeep was direction-agnostic

The variable was named "Forward" but the check matched every detail->detail nav
(forward push AND backward popstate), and `direction` was hardcoded `'forward'`
for all of them (wrong macro metadata for a backward popstate). A and B share
this root. Fixed: renamed to `isDeepToDeep`; `direction` is now derived from
`navigation.type` (`'popstate'` -> `'backward'`, else `'forward'`). The slide is
unchanged: the axis-override forces `'right'` for every deep-to-deep nav
(forward via the override, backward directly from the resolver), so both
directions reveal the left-panel skeleton identically. Verified e2e-safe
(forward-deep-to-deep-slide, deep-to-deep-gesture tests pass).

### A2 (CONCERN, comment scope) - #enterAnimationArmedSettle docstring

The docstring claimed the flag stops the post-URL-swap title change from
re-arming the settle. The flag guards only the IDLE re-arm branch; the
mid-settle re-arm branch is not gated (it re-latches the title endpoint
continuously from the current `settleProgress`, no snap, and may still fire).
Fixed: the docstring now scopes the guard to the IDLE re-arm branch.

### Nitpick (`.md`)

Spec end-state #2 said the FAB family-swap ease runs "in the FAB layer"; it runs
on the orchestrator's rAF (the FAB layer reads `pager.familySwapScale`
reactively). Corrected at every occurrence outside the authoritative Global
animation manager section.

## Gate outputs (post-fix, independently re-run by the orchestrator)

```
$ bun run check                       0 errors / 0 warnings (1458 files)
$ bun run lint                        EXIT=0
$ bun test src/lib/utils src/lib/stores    409 pass / 0 fail
$ bun run test:e2e                    201 passed + 1 flaky (fab.spec.ts:430,
                                     the pre-existing CDP touch flake)
```

The B1 interception change and the A1 direction derivation are e2e-safe: every
detail-to-deep slide (forward and backward) and plain navigation to non-pipeline
targets pass unchanged. No behavioral regression.

R30 audits the post-R29-fix state.

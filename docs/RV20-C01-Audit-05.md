# RV20-C01 - Audit Round 05

Five independent auditors (A, B, C, D, E) examined the live codebase
post-R4-fix (`FabFamily` unified, unused re-exports removed,
`header-mode.ts` search-branch journal wording corrected in the
two locations R4 caught). The prompt was the same role-less,
hint-less instruction; the bar is 5/5 unconditional PASS with zero
concerns.

## Tally

| Auditor | Verdict            | Confidence | Primary finding                                                                                                                                                                             |
| ------- | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A       | PASS-WITH-CONCERNS | high       | Journal "header-mode" wording fix applied to only 1 of 3 locations; deviation #1 overstates `backParent` extension impact for `/discussion/*` and `/messages/<id>`                          |
| B       | PASS-WITH-CONCERNS | high       | `isGesturePageLayoutRoute` docstring + describe/test comments mis-state the latent-bug set (includes `/admin` and sub-pages which actually return TRUE); `getRouteTag` unused outside tests |
| C       | PASS               | high       | 0 defects, 0 concerns                                                                                                                                                                       |
| D       | PASS-WITH-CONCERNS | high       | Same as A's concern 1: header-mode journal wording fix applied to only 1 of 3 locations                                                                                                     |
| E       | PASS               | high       | 0 defects, 0 concerns                                                                                                                                                                       |

**Round 5 result: 2/5 PASS, 3/5 PASS-WITH-CONCERNS, 0 FAIL.**

All five auditors agreed the code is correct, behavior-preserving,
and matches the pre-Cycle-1 baseline. No defects found by any
auditor. The three PASS-WITH-CONCERNS verdicts all rest on
documentation/commentary inaccuracies:

1. **Concern 1 (auditors A and D): `header-mode.ts` journal wording
   fix was incomplete.** The R4 fix updated the "Design decisions"
   entry but left the same inaccurate phrase ("search branch reads
   the record's tag") in the "Failures during implementation" and
   "Deviations" sections. The actual implementation uses a literal
   `/search` prefix check.
2. **Concern 2 (auditor A): deviation #1 overgeneralizes the
   `backParent` extension impact.** The journal claimed extending
   `backParent` to `/discussion/*` and `/messages/<id>` would flip
   `isGesturePageLayoutRoute` and `resolvedLeftHref`. Empirically
   verified: those routes already return TRUE via the overlay-non-deep
   branch, so adding `backParent` does not flip them. Only the
   latent-bug four (`/bookmarks`, `/search`, `/notifications`,
   `/profile`) actually flip when `backParent` is added.
3. **Concern 3 (auditor B): `isGesturePageLayoutRoute` docstring
   over-lists the latent-bug set.** The docstring claimed the
   function returns FALSE for `/search`, `/bookmarks`, `/profile`,
   `/admin`, `/notifications` and the sub-pages of the last four.
   Empirically verified: the function returns TRUE for `/admin`
   (carries `backParent: '/'`) and for every `/profile/*` and
   `/admin/*` sub-page in the registry (all carry `backParent`).
   The actual false-set is the four leaf routes only.
4. **Concern 4 (auditor B): describe-block comment in
   `route-config.test.ts` carried the same over-listed set.**
5. **Concern 5 (auditor B): test name "FALSE for non-FAB GPL routes"
   contradicted an assertion expecting `true` for `/admin/user-groups`.**
6. **Concern 6 (auditor B): `getRouteTag` helper unused outside tests.**
   Same category as R4's unused re-exports: dead speculative surface.

## Fixes applied between Round 5 and Round 6

1. **`header-mode.ts` journal wording propagated to all three
   locations.** The "Failures during implementation" and "Deviations"
   sections now describe the search branch accurately as a literal
   `/search` prefix check, matching the "Design decisions" section
   and the Plan-Journal.
2. **Deviation #1 rewritten.** The journal now distinguishes the
   safe-to-extend cases (`/discussion/*`, `/messages/<id>`, already
   TRUE via overlay-non-deep; `resolvedLeftHref` substitution does
   not fire because `target !== '/'`) from the latent-bug four
   (`/bookmarks`, `/search`, `/notifications`, `/profile`, where
   extending `backParent` would flip `isGesturePageLayoutRoute` from
   FALSE to TRUE, dissolving the masked bug). The conservative choice
   (mirror
   today's `getParent` set) stands; the reasoning is now accurate.
3. **`isGesturePageLayoutRoute` docstring corrected.** The masked
   latent-bug set is now listed as the four leaf routes only; the
   docstring notes that sub-pages of `/profile` and the `/admin/*`
   tree declare `backParent` and therefore return TRUE.
4. **Describe-block comment in `route-config.test.ts` corrected**
   to list only the actual latent-bug routes.
5. **Test renamed and re-commented.** The test previously named
   "FALSE for non-FAB GPL routes" is now "latent-bug leaf routes
   return FALSE; backParent-declaring sub-pages return TRUE", and
   the inline comment explains why `/admin/user-groups` returns TRUE.
6. **`getRouteTag` removed.** The helper had no production consumer.
   Its test assertions are removed; the `getRouteData(...).tag`
   assertions remain.

Verification after the fixes:

```
$ bun run check
1783198279867 START "/home/losses/Development/janbao"
1783198279871 COMPLETED 1432 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ bun run lint
Checking formatting...
All matched files use Prettier code style!
(0 eslint errors; similarity-ts informational only)

$ bun test src/lib/utils/
 170 pass
 0 fail
 725 expect() calls
Ran 170 tests across 10 files. [89.00ms]

$ bun test src/
 280 pass
 0 fail
 1510 expect() calls
Ran 280 tests across 20 files. [1.98s]
```

The expect() count dropped from 762 to 725 in `src/lib/utils/` and
from 1547 to 1510 in `src/` because the removed `getRouteTag`
assertion line (inside the 37-case tag-assignments loop) deleted 37
`expect()` calls; the test count is unchanged (170 / 280).

Round 6 re-runs the audit on the post-R5-fix codebase.

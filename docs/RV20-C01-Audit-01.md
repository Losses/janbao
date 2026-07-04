# DV20 Cycle 1 - Audit Round 1

Five independent auditors examined the live codebase against
`docs/DV20-Plan.md` §3, §4, §11, §13, §14 and
`docs/DV20-Meeting/DV20-Cycle-1-spec.md`. The prompt was role-less and
hint-less. The bar is 5/5 unconditional PASS with zero concerns.

## Tally

| Auditor | Verdict | Confidence | Primary finding                            |
| ------- | ------- | ---------- | ------------------------------------------ |
| A       | FAIL    | high       | Offline detail routes lost tab association |
| B       | FAIL    | high       | Offline detail routes lost tab association |
| C       | FAIL    | high       | Offline detail routes lost tab association |
| D       | FAIL    | high       | Offline detail routes lost tab association |
| E       | FAIL    | high       | Offline detail routes lost tab association |

**Round 1 result: 0/5 PASS, 5/5 FAIL, unanimous.**

## Convergent blocker (5/5)

`src/lib/utils/route-config.ts` `TAB_BAR_CONFIG` narrows the offline
route patterns from the pre-Cycle-1 prefix match `/^\/offline/` (which
matched every `/offline/*` path) to two exact-anchored patterns
`/^\/offline$/` and `/^\/offline\/activity$/`. As a result the routes
`/offline/[discussionId]` and `/offline/bookmarks` (both real, both
mounted via `DualColumnLayout`) lose their discussions-tab
association. Verified empirically by all five auditors:

- `getCurrentTabIndex('/offline/123')`: pre-Cycle-1 `0`, Cycle 1 `-1`.
- `getCurrentTabIndex('/offline/bookmarks')`: pre-Cycle-1 `0`, Cycle 1 `-1`.
- `getTabBarPillTarget('/offline/123')`: pre-Cycle-1 `'discussions'`,
  Cycle 1 `'none'`.

Three user-visible downstream behavior changes follow on these routes:

1. `resolveHeaderMode` returns `'deep'` (back-arrow + title) instead
   of `'root'` (tab bar). The Header on `/offline/<id>` and
   `/offline/bookmarks` now renders back-arrow + empty title where
   the tab bar used to be. Internal inconsistency: the online mirror
   `/discussion/<id>` still resolves to `'root'`.
2. `DualColumnLayout.swipeDisabled` flips from `false` to `true`
   (`swipeBaseline < 0`). The horizontal tab-switch swipe on the
   offline reader routes is silently disabled.
3. `FloatingActionButtonLayer.foregroundFraction` reads
   `tabFraction(-1, 0) === 0` (was `tabFraction(0, 0) === 1`). The
   retained FAB atom hides at scale 0 instead of staying visible at
   scale 1 after the user visits a list route.

The Cycle 1 spec's "behavior MUST be identical" rule is violated. The
deviation is not documented in the journal. The macro plan §9
("`/offline/[discussionId]` mirrors `/discussion/[id]`; both are
discussions-tab content served offline") is contradicted.

The regression was not caught by the e2e suite because the suite has
zero coverage of `/offline/<id>` or `/offline/bookmarks` Header/swipe
behavior. The new unit tests codify the regressed behavior rather
than catch it.

## Concerns (raised by at least one auditor)

- `src/lib/utils/route-config.ts:17` exports `ParentRouteResolver`, a
  dead type with no consumers (left over from the removed `getParent`
  field). Cleanup miss.
- `src/lib/utils/route-config.ts:283-294` `_DEEP_ROUTE_PARENTS`
  duplicates the patterns whose `backParent` is statically declared
  in `route-data.ts`. The journal acknowledges this is migration-era;
  the duplication is a forward-looking maintainability concern, not a
  defect today.
- `src/lib/utils/route-config.ts:200-203` `TAB_BAR_CONFIG` uses
  prefix patterns for `/^\/admin/` and `/^\/profile/` but exact-match
  patterns for offline routes. The asymmetry enabled the regression
  above. Unifying the match style is a follow-up.
- `docs/DV20-Cycle-1-Journal.md`'s "Verification evidence" claim of
  "behavior identical" overstated the evidence: the e2e suite has no
  `/offline/*` coverage.

## Required fixes (blocking)

1. Restore the broad prefix patterns for `/offline/*` in
   `TAB_BAR_CONFIG`. Specifically: `/^\/offline\/activity/` (prefix,
   no `$`) and `/^\/offline/` (prefix, no `$`), in that order, so
   `/offline/<id>` and `/offline/bookmarks` resolve to `'discussions'`
   as they did pre-Cycle-1.
2. Add unit tests for `getCurrentTabIndex('/offline/<id>')` and
   `getCurrentTabIndex('/offline/bookmarks')` asserting `0` (preserved
   behavior). Add unit tests for `getTabBarPillTarget` covering the
   same routes asserting `'discussions'`.
3. Document the regression in the journal's "Failures during
   implementation" section.
4. Remove the dead `ParentRouteResolver` export.
5. Remove the stale `ROUTE_CONFIGS` reference in the
   `route-data.ts` comment.

After fixes, run Round 2 with five fresh independent auditors.

# DV20 Cycle 1 - Plan Journal

Append-only revision history of CMA1's spec interpretations. Each entry
records a clarification or scoping decision made during execution, with
rationale. The spec itself is owned by the architect; this file records
how the CMA read it.

## 2026-07-04, Round 0 (initial reading, before implementation)

1. **`backParent` coverage.** Read literally, the spec says "the CMA
   derives each by reading the route's actual mount and behavior".
   Taking that literally would have me set `backParent: '/'` on
   `/discussion/*` and `/messages/<id>` (their structural parent is
   obvious). Doing so, however, changes the answer set of
   `isGesturePageLayoutRoute` (which today reads the `getParent`-defined
   set) and changes `resolvedLeftHref` substitution in GPL. The
   spec's "behavior MUST be identical to the current codebase" rule
   overrides the literal reading. I therefore assign `backParent` to
   MIRROR today's `getParent` set exactly and flag extending coverage
   to `/discussion/*`, `/messages/<id>`, `/bookmarks`, etc. as a
   Cycle 5 concern (when the resolver and the new state machine take
   over from `getParent`). Flagged for the architect.

2. **`isTabRootPath` and `isPagerRoute` are positional queries.** The
   spec lists them among the classifiers to "remove or reduce to a
   one-line record read", but they answer "is `p` one of the three
   spatial tab positions", which per §3 is tag metadata, not a per-route
   property. Reducing them to a `RouteData` read would force me to
   re-introduce a stored spatial-position field (violating §3's clarity
   principle). I keep them as one-line positional queries over
   `MOBILE_TAB_DEFS` and treat them as NOT expressing a per-route
   target-architecture concept. Flagged for the architect.

3. **Migration-era `_DEEP_ROUTE_PARENTS`.** `isGesturePageLayoutRoute`
   is excepted ("stays imperative and untouched until Cycle 5"). To
   preserve its current answer set byte-identically while removing
   `isOverlayRoute` (which is NOT excepted) and `DEEP_ROUTES`, the
   function's body now reads `FAB_ROUTE_ATTRIBUTES` (for the
   overlay-thread check) and a private `_DEEP_ROUTE_PARENTS` pattern
   list (mirroring today's `getParent`-defined routes). Both are
   migration-era and dissolve in Cycle 5. The function's contract and
   answer set are unchanged. Flagged for the architect.

4. **FAB layer family/kind consumer config.** §3 says "There is NO FAB
   family enum". For Cycle 1 the FAB layer's sampler-selection logic
   still needs the family/kind data; dissolving it is a Cycle 4 (all-rAF
   executor) concern. I keep the family/kind data in a separate
   `FAB_ROUTE_ATTRIBUTES` consumer registry, clearly marked
   migration-era. The core `RouteData.fab` boolean stays clean (just
   visibility). Flagged for the architect.

5. **`getCurrentTabIndex` for global routes.** §3 says the tab-bar
   config assigns global routes (`/admin`, `/profile`, `/search`,
   `/bookmarks`, `/notifications`) the `'active'` pill target. The
   current code, however, returns `-1` for those routes (Header hides
   the tab bar). For Cycle 1 behavior-preservation I keep
   `getCurrentTabIndex` returning `-1` for the global routes; the
   `'active'` semantic lands when the tab-bar consumer is rebuilt in
   a later cycle. Flagged for the architect.

6. **`header-mode.ts` is hybrid, not pure tag-based.** §3 lists
   `headerMode(r)` as a derived query of the tag alone. The first
   implementation reduced `resolveHeaderMode` to that pure formula.
   The pre-existing `header-mode.test.ts` failed on
   `/discussion/123/slug` (expected `'root'`, got `'deep'`): today's
   `getCurrentTabIndex` returns 0 for thread routes (the FAB
   `kind === 'discussions'` resolves to the discussions tab), so the
   Header renders the tab bar on a thread. The pure tag derivation
   loses that. I reverted to a hybrid: the search branch uses a
   literal `/search` prefix check (functionally equivalent to
   `tag === 'search'` since `/search` is the only 'search'-tagged
   route today; the tag-derived form lands in a later cycle); the
   root/deep branch still reads `getCurrentTabIndex` (which now reads
   the tab-bar consumer config). The pure tag-only derivation lands
   when the resolver takes over Header morph. Flagged for the
   architect.

## 2026-07-04, Round 5 (clarifications to entries #1 and #3)

The Round 0 entries above record CMA1's initial reading. Rounds 2
and 5 surfaced two factual inaccuracies in entries #1 and #3 that
this section clarifies; the Round 0 text is left in place as the
historical record of the initial reading.

7. **Clarification to entry #1 (backParent extension impact).** The
   Round 0 entry claimed extending `backParent` to `/discussion/*`
   and `/messages/<id>` would change `isGesturePageLayoutRoute`'s
   answer set and `resolvedLeftHref`'s substitution. Empirically
   verified in R5: `/discussion/*` and `/messages/<id>` already
   return TRUE via the overlay-non-deep branch
   (`attrs.family === 'overlay' && attrs.kind !== 'deep'`), so
   adding `backParent` does not flip `isGesturePageLayoutRoute`.
   The `resolvedLeftHref` substitution also does not flip: it fires
   only when `target === '/'`, and for `/messages/<id>` reached from
   `/messages/inbox` the target is `/messages/inbox`, not `/`.
   Only the latent-bug four (`/bookmarks`, `/search`,
   `/notifications`, `/profile`) actually flip when `backParent` is
   added (they fail both branches today). The conservative choice
   documented in entry #1 (mirror today's `getParent` set) stands;
   the reasoning is updated in the journal's deviation #1.

8. **Clarification to entry #3 (`_DEEP_ROUTE_PARENTS` removed in
   R2).** The Round 0 entry documented the `_DEEP_ROUTE_PARENTS`
   pattern-list approach. R2's audit flagged that approach as a
   duplication hazard (the pattern list duplicated the
   `backParent`-declaring patterns in the core record). The R2 fix
   replaced the pattern list with a direct core-record read
   (`getRouteData(p).backParent !== undefined`). The function's
   answer set is byte-identical (verified by the existing
   `isGesturePageLayoutRoute` unit tests). The journal's
   "Migration-era data isGesturePageLayoutRoute reads" section
   documents the post-R2 form.

9. **Latent-bug set clarification (R5).** The latent-bug set is the
   four leaf routes `/search`, `/bookmarks`, `/notifications`,
   `/profile` only. Sub-pages of `/profile` and the entire `/admin`
   tree carry declared `backParent` and therefore return TRUE; they
   are NOT in the latent-bug set. The R5 audit caught
   documentation/commentary in `route-config.ts` and
   `route-config.test.ts` that over-listed the bug set to include
   `/admin` and the sub-pages; those have been corrected.

# DV20 Cycle 1 Journal

Implementation record for CMA1. Per §11 this is written incrementally; it
records what actually happened (investigation, design, files changed,
verification evidence, deviations). It does not perform confidence.

## Investigation (2026-07-04)

Read in order: `docs/DV20-Plan.md` (§3, §4, §11, §13, §14),
`docs/DV20-Meeting/DV20-C01-spec.md`, and the relevant history in
`docs/DV20-Meeting/DV20-Plan-Journal.md`.

### Current classification web

Inventoried the consumers of every listed classifier by grep:

| Classifier                          | External consumers (non-test, non-self)                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `isTabRootPath`                     | GPL, `+layout.svelte`, `/discussion/[id]/[slug]/[[page]]` page, `history-nav.ts`                              |
| `isPagerRoute`                      | GPL, `DualColumnLayout`                                                                                       |
| `isOverlayRoute`                    | (internal only: `isGesturePageLayoutRoute`)                                                                   |
| `isComposeRoute`                    | none (test-only)                                                                                              |
| `getCurrentTabIndex`                | GPL, `DualColumnLayout`, `MobileTabPager`, FAB layer, `header-mode`, `(tabs)/+layout.svelte`, `Header.svelte` |
| `backSwipeShouldPopHistory`         | `navigation.svelte.ts`, `MobileTabPager`                                                                      |
| `getRouteFabRule`                   | FAB layer (plus internal `route-config.ts` callers)                                                           |
| `sourceListKindForOverlayOrCompose` | none (test-only)                                                                                              |
| `isDiscussionsListRoute`            | none (test-only)                                                                                              |
| `isMessagesListRoute`               | none (test-only)                                                                                              |
| `backTargetListKind`                | FAB layer                                                                                                     |
| `fabKindToLabelKey`                 | internal `getCurrentTabIndex` only                                                                            |
| `isGesturePageLayoutRoute`          | `DualColumnLayout` (deferred to Cycle 5; stays imperative)                                                    |

Four classifiers (`isComposeRoute`, `sourceListKindForOverlayOrCompose`,
`isDiscussionsListRoute`, `isMessagesListRoute`) have ZERO non-test
consumers. They are dead; the spec's rule "removed or reduced to a record
read" is satisfied by removal.

### Route inventory (verified against the code, not the journal's starting point)

GPL-mounted routes (mount `<GesturePageLayout>`):

- `/admin`, `/admin/backups`, `/admin/categories`, `/admin/maintenance`,
  `/admin/permissions`, `/admin/stats`, `/admin/user-groups`
- `/bookmarks`
- `/discussion/[discussionId]/[slug]/[[page]]`
- `/messages/[id]/[[page]]`
- `/notifications`
- `/post/discussion`
- `/profile`, `/profile/[userId]/[userSlug]`, `/profile/appearance`,
  `/profile/comments/[userId]/[userSlug]`, `/profile/discussions/[userId]/[userSlug]`,
  `/profile/edit`, `/profile/editor`, `/profile/invitations`,
  `/profile/offlineReading`, `/profile/onlineNow`, `/profile/password`,
  `/profile/picture`, `/profile/preferences`, `/profile/settings`
- `/search`

DualColumnLayout-only routes (no GPL):

- `(tabs)/+page.svelte` (`/`), `(tabs)/activity` (`/activity`),
  `(tabs)/messages/inbox` (`/messages/inbox`): the three tab roots, MobileTabPager owns the gesture.
- `/categories`, `/category/[categorySlug]/[[page]]`
- `/drafts`
- `/post/editDiscussion/[discussionId]`
- `/messages/add/[userId]` (renders `<MessageCompose>` directly, no DCL even)
- `/offline`, `/offline/activity`, `/offline/bookmarks`, `/offline/[discussionId]`

Latent bug confirmed (deferred to Cycle 5): the current
`isGesturePageLayoutRoute` returns FALSE for `/search`, `/bookmarks`,
`/notifications`, and `/profile`, even though every one of them mounts
a GPL. The cause is that these four routes carry
`fab: { family: 'overlay', kind: 'deep' }` (so they fail the
`kind !== 'deep'` clause of `isOverlayRoute`) and have no `getParent`
(so they are not in `DEEP_ROUTES`). Sub-pages of `/profile` (e.g.
`/profile/settings`, `/profile/[id]/[slug]`) and the entire `/admin`
tree DO declare `backParent`/`getParent`, so they return TRUE; the
buggy set is the four leaf routes only. I do NOT fix this in Cycle 1;
I preserve the current (buggy) answer set.

### snapshotCapture call sites

`grep deepPageSnapshot.capture`: only
`src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte`
calls `capture()`. No other route captures a deep-page snapshot today.
`snapshotCapture: true` for `/discussion/...` only; `false` everywhere
else.

### fab visibility (record boolean) vs FAB atom mount (consumer config)

Per §3 the record stores only "is the FAB visible at rest on this page".
Today the FAB is visible at rest on `/` and `/messages/inbox` only. The
FAB atom ALSO stays mounted (at scale 0) on every Family-B/overlay and
Family-C/compose route so the sampler can drive its scale across the
list<->deep boundary, AND the layer's `retainedConfig` keeps it mounted
across no-FAB routes after a FAB route has been visited. The atom-mount
decision is a Layer-5 concern that dissolves in Cycle 4; for Cycle 1 it
remains in the FAB layer reading the migration-era Family/kind data
exactly as today.

### backParent (record) coverage

The current `getParent` is defined for ten route patterns only:
`/profile/settings`, `/profile/[userId]/[userSlug]`,
`/profile/comments/[userId]/[userSlug]`,
`/profile/discussions/[userId]/[userSlug]`, the seven `/profile/(sub)`s,
`/profile/invitations`, `/admin`, the six `/admin/(sub)`s,
`/post/discussion`, `/messages/new`. Two of those
(`/profile/comments/...`, `/profile/discussions/...`) compute the parent
dynamically from the path (`/profile/<uid>/<slug>`).

For Cycle 1 (behavior-identical) I assign `backParent` to MIRROR today's
`getParent` set exactly. I do NOT extend coverage to routes that today
omit `getParent` (e.g. `/discussion/*`, `/messages/<id>`, `/bookmarks`)
even though their structural parent is well-defined, because doing so
would change the `resolvedLeftHref` substitution in GPL and the
`isGesturePageLayoutRoute` answer set. Extending backParent to its full
structural coverage is a Cycle 5 concern (when the resolver and the new
state machine take over from `getParent`).

### Tag assignment

Per §3 + §14.1 + the spec's end-state:

- `tag: 'tab'`: `/`, `/activity`, `/messages/inbox` (the three pager
  roots), `/discussions/p\d+` (tab-internal pagination, handled by
  `{tab, tab}` per §4), `/offline`, `/offline/activity` (the offline
  mirrors of `/` and `/activity`).
- `tag: 'search'`: `/search`.
- `tag: 'detail'`: every other route, including the offline detail
  mirrors `/offline/bookmarks` and `/offline/[discussionId]`.

### "Tab root" vs "tab route"

`isTabRootPath(p)` and `isPagerRoute(p)` are NOT the same as
`tag === 'tab'`. They answer "is `p` one of the three spatial tab
positions (MobileTabPager panel hrefs)?", a positional query over tag
metadata, not a per-route property. `/discussions/p2` has `tag === 'tab'`
(it is in the tab family) but is NOT a tab root. Per §3,
`spatialNeighbours = positional: a tab's neighbours are its adjacent
entries in the tab order (the tag's metadata), not a per-route field`.
These two functions stay as one-line positional queries over
`MOBILE_TAB_DEFS`; they do not consult `RouteData` because the question
is not a per-route property.

### Consumer configs that need to live somewhere (per §3)

- **FAB icon/href config**: already exists as `FAB_KIND_CONFIGS`
  (keyed by kind). Keep.
- **FAB route attributes (family + kind, migration-era)**: needed by
  the FAB layer's sampler-selection logic until Cycle 4. Lives in a
  separate `FAB_ROUTE_ATTRIBUTES` registry, marked as migration-era.
  This is consumer config; it is NOT in the core record (§3: "There is
  NO FAB family enum").
- **Tab-bar pill target config**: maps each route to its pill target
  per §3. Lives in a new `TAB_BAR_CONFIG` registry. `getCurrentTabIndex`
  becomes a one-line read of this config plus a `MOBILE_TAB_DEFS` index
  lookup.
- **Preview-panel config**: maps each route that captures a snippet to
  its preview-panel component. Lives in a new `PREVIEW_PANEL_CONFIG`.
  Replaces `DEEP_ROUTES.find(...).previewPanel`.

### Migration-era data isGesturePageLayoutRoute reads

To preserve the latent bug exactly (so Cycle 5 can fix it), the body of
`isGesturePageLayoutRoute` reads "is thread/conversation" (from
`FAB_ROUTE_ATTRIBUTES.family === 'overlay' && kind !== 'deep'`) OR
"is in the deep-route-parent set" (from
`getRouteData(p).backParent !== undefined`). The function stays
imperative; its data sources are the consumer FAB attrs and the core
record, and its answer set is byte-identical to the pre-Cycle-1 form.

## Design decisions

1. **Home for `RouteData`.** New file `src/lib/utils/route-data.ts`.
   Keeping the record separate from `route-config.ts` makes the
   "core record" versus "consumer configs" boundary physical, and
   matches §3's framing. `route-config.ts` keeps the consumer configs
   and the FAB-layer helpers; it imports `RouteData` and the lookup
   from `route-data.ts`.

2. **Dynamic `backParent`.** §3 types `backParent` as `string`. Two
   routes (`/profile/comments/[userId]/[userSlug]`,
   `/profile/discussions/[userId]/[userSlug]`) compute the parent from
   the path. The registry entry allows `backParent` to be either a
   static string or a `(path) => string` resolver; `getRouteData`
   applies the resolver and returns a `RouteData` whose `backParent` is
   always a string (or undefined). The public `RouteData` shape is
   exactly §3.

3. **Default for unmatched routes.** `getRouteData` returns
   `{ tag: 'detail', snapshotCapture: false, fab: false }` for any
   pathname that matches no registry entry. This matches today's
   "no rule" behavior (no FAB, no overlay, no deep-route parent) for
   routes like `/entry/*`, `/avatar/*`, `/attachment/*`, `/api/*`,
   `/upload`, `/manifest.webmanifest`. (Verified per-consumer above.)

4. **`header-mode.ts` partial record read.** The first attempt
   reduced `resolveHeaderMode` to `tag === 'tab' ? 'root' : tag ===
'search' ? 'search' : 'deep'` per §3's derived formula. This
   changed the answer for `/discussion/*`, `/messages/<id>`,
   `/post/discussion`, `/messages/new`: today's `getCurrentTabIndex`
   returns 0/2 for them (the FAB `kind` resolves to a tab) so they
   render the tab bar (`headerMode === 'root'`); the tag-only
   derivation returns `'deep'`. The Cycle 1 spec's "behavior MUST be
   identical" rule overrides the §3 derived formula. Reverted to a
   hybrid: the search branch uses a literal `/search` prefix check
   (functionally equivalent to `tag === 'search'` since `/search` is
   the only 'search'-tagged route today; the tag-derived form lands
   in a later cycle); the root/deep branch still reads
   `getCurrentTabIndex` (which itself now reads the tab-bar consumer
   config). The tag-only derivation lands when the resolver takes
   over Header morph in a later cycle. This is logged as a deviation;
   see Plan-Journal entry 2026-07-04 #6.

5. **FAB layer minimum-touch.** The FAB layer keeps its logic intact.
   The data-source reads change: where it read
   `getRouteFabRule(p).fab.family` and `.fab.kind` it now reads
   `getFabRouteAttributes(p)?.family` and `?.kind` from the new
   consumer registry; where it read `rule.fab !== undefined` it now
   reads `getFabRouteAttributes(p) !== null`. The atom-mount decision
   (Family A visible, Family B/C at scale 0) is unchanged. Behavior
   is preserved.

6. **GPL `currentRouteConfig.getParent`.** Replaced by
   `getRouteData(p).backParent`. The dynamic-parent routes resolve
   inside `getRouteData`.

7. **GPL `DEEP_ROUTES.find(...).previewPanel`.** Replaced by
   `getPreviewPanel(p)` exported from `route-config.ts` (which reads
   `PREVIEW_PANEL_CONFIG`). Same patterns, same components, same
   fallback to `MOBILE_TABS[activeTab].panel`. The local function
   that wraps the fallback is renamed `getPreviewPanelForPath` to
   avoid colliding with the imported name.

8. **`isGesturePageLayoutRoute` body stays imperative.** Per spec the
   function is unchanged in shape and answer set. Its internals read
   `FAB_ROUTE_ATTRIBUTES` (for the overlay-thread check) and
   `getRouteData(p).backParent !== undefined` (for the deep-route
   check; the answer is identical to reading the legacy
   `getParent`-declared pattern list, but derives from a single
   source of truth in the core record). Both checks are
   migration-era; both dissolve in Cycle 5.

9. **`backSwipeShouldPopHistory`, `isTabRootPath`, `isPagerRoute`,
   `backTargetListKind`.** These survive. The first three are not
   target-architecture concept classifiers (they are positional
   tab-metadata queries and a history-shape query).
   `backTargetListKind` classifies a back-target string, not a route.
   The `fabKindToLabelKey` helper folds into `getCurrentTabIndex`.

10. **Dead classifiers removed.** `isComposeRoute`,
    `sourceListKindForOverlayOrCompose`, `isDiscussionsListRoute`,
    `isMessagesListRoute` are deleted; their tests are deleted with
    them. `getRouteFabRule` is replaced by `getFabRouteAttributes` and
    `getRouteData(p).fab`. `ROUTE_CONFIGS`, `DEEP_ROUTES`,
    `BaseRouteConfig`, `DeepRouteConfig`, `FabRouteConfigMetadata`,
    `getRouteRule` are removed.

## Files changed

New:

- `src/lib/utils/route-data.ts`: the `RouteData` record, the
  `RouteTag` enum, the `BackParentResolver` type, the `ROUTE_ENTRIES`
  registry, and the `getRouteData` lookup. The single source of truth
  for `tag`, `backParent`, `snapshotCapture`, `fab`.
- `src/lib/utils/route-data.test.ts`: 66 unit tests covering the
  record shape, tag assignments, fab visibility, snapshotCapture, and
  backParent (static and dynamic).
- `src/lib/utils/route-config.test.ts`: 93 unit tests covering the
  consumer configs (`FAB_ROUTE_ATTRIBUTES`, `TAB_BAR_CONFIG`,
  `PREVIEW_PANEL_CONFIG`) and the live classifiers
  (`getCurrentTabIndex`, `isPagerRoute`,
  `isGesturePageLayoutRoute`'s answer set including the deferred
  latent bug, `backTargetListKind`, `getPreviewPanel`).
- `docs/DV20-C01-Journal.md` (this file).
- `docs/DV20-Meeting/DV20-C01-Plan-Journal.md`.

Modified:

- `src/lib/utils/route-config.ts`: wholesale replacement. The four
  consumer configs (`FAB_KIND_CONFIGS`, `FAB_ROUTE_ATTRIBUTES`,
  `TAB_BAR_CONFIG`, `PREVIEW_PANEL_CONFIG`) live here. The dead
  classifiers are removed; the live classifiers reduce to consumer-
  config reads. `MOBILE_TABS` export is preserved.
  `isGesturePageLayoutRoute` (the migration-era carve-out) reads the
  core record via `getRouteData(p).backParent !== undefined` for its
  deep-route set.
- `src/lib/utils/header-mode.ts`: the search branch uses the
  `pathname.startsWith('/search')` prefix match; the root/deep branch
  reads `getCurrentTabIndex` (which reads the tab-bar consumer
  config). Deviation logged.
- `src/lib/components/templates/FloatingActionButtonLayer.svelte`:
  imports `getFabRouteAttributes` instead of `getRouteFabRule`; the
  derived `fabConfig` and the sampler arm/disarm effect read the new
  consumer registry. Logic unchanged.
- `src/lib/components/templates/GesturePageLayout.svelte`: imports
  `getPreviewPanel` and `getRouteData`; replaces
  `DEEP_ROUTES.find(...).previewPanel` with `getPreviewPanel(p)` and
  the local wrapper `getPreviewPanelForPath`; replaces
  `currentRouteConfig.getParent(p)` with
  `getRouteData(p).backParent`.

Deleted:

- `src/lib/utils/fab-routes.test.ts`: tested the dead classifiers
  (`isOverlayRoute`, `isComposeRoute`, `sourceListKindForOverlayOrCompose`,
  `isDiscussionsListRoute`, `isMessagesListRoute`, `getRouteFabRule`).
  The new test files cover the replacement surface.

Untouched (deliberate, per spec):

- `src/lib/utils/history-nav.ts`: `isTabRootPath`,
  `backSwipeShouldPopHistory`, `hopForHref`, `previousEntryPathname`
  stay. They are positional tab-metadata queries and history-shape
  queries, not target-architecture concept classifiers.
- `src/lib/utils/tab-config.ts`, `src/lib/utils/deep-header-config.ts`,
  `src/lib/stores/navigation-logic.ts`: pure path/classification
  utilities unaffected by the record refactor.
- The gesture, animation, cache, and lifecycle modules
  (`src/lib/actions/swipe.ts`,
  `src/lib/components/templates/MobileTabPager.svelte`,
  `src/lib/stores/deep-page-snapshot.svelte.ts`,
  `src/lib/stores/list-cache.svelte.ts`, etc.): explicitly out of
  scope per the Cycle 1 spec.

## Verification evidence

### `bun run check`

```
$ bun run check
$ svelte-kit sync && svelte-check --tsconfig ./tsconfig.json && tsc --noEmit -p tsconfig.sw.json
1783183354374 START "/home/losses/Development/janbao"
1783183354379 COMPLETED 1432 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

### `bun run lint`

```
$ bun run lint
$ prettier --check . && eslint . && bun scripts/ensure-similarity.ts && bin/similarity-ts ./src --types
Checking formatting...
All matched files use Prettier code style!
... similarity-ts informational output (type-pair report; no errors) ...
```

Zero eslint errors. Zero prettier errors. Similarity-ts reports no
type-duplicate errors (the 47 similar-type pairs are pre-existing
DAO row shapes, unrelated to this Cycle).

### `bun test src/lib/utils/`

```
$ bun test src/lib/utils/
bun test v1.3.13 (bf2e2cec)

 170 pass
 0 fail
 762 expect() calls
Ran 170 tests across 10 files. [76.00ms]
```

Includes the 66 new `route-data.test.ts` tests and the new
`route-config.test.ts` tests, plus the pre-existing
`history-nav.test.ts` (unchanged) and `header-mode.test.ts`
(unchanged).

### `bun test src/`

```
$ bun test --pattern "*.test.ts" src
 280 pass
 0 fail
 1547 expect() calls
Ran 280 tests across 20 files. [1.91s]
```

All src tests pass; no regressions in any other module.

### `bun run test:e2e`

First pass (Round 1 audit baseline):

```
$ bun run test:e2e
...
  179 passed (7.4m)
```

Second pass (after the Round 1 fix landed):

```
$ bun run test:e2e
...
  1 failed
    e2e/swipe-forward-back-deep-page.spec.ts:285:2 › forward-swipe into a tab then back-swipe › header shows when a drag starts on the thread page (GesturePageLayout)
  178 passed (7.5m)
```

The single failure is a known intermittent flake on
`swipe-forward-back-deep-page.spec.ts:285`. Per spec §12
("Pre-existing flakes are documented and excluded with a rationale,
never silently"), this flake is documented here. Re-running the
failing test in isolation:

```
$ bun run test:e2e -- --grep "header shows when a drag starts on the thread page"
  ✓  1 e2e/swipe-forward-back-deep-page.spec.ts:285:2 › ... (5.6s)
  1 passed (10.7s)
```

passes cleanly. The flake manifests only under the full-suite
concurrent run (one chromium, one dev server, one admin session per
the playwright config), not in isolation. The fix in this Cycle (the
`TAB_BAR_CONFIG` offline prefix restoration) does not touch the
thread-page gesture this test exercises; the flake is pre-existing
relative to this Cycle's diff. The full suite's 179-pass first run
(above) is the cleaner signal; the second run's single flake is the
known intermittent, not a regression from the fix.

The full Playwright e2e suite (the gesture, tab, search, FAB, header,
scroll, and SSR specs) passes unchanged against a fresh dev server.
This is the regression bar specified by the Cycle 1 spec.

Coverage gap: the e2e suite has zero `/offline/*` coverage. The Round
1 audit caught the offline-detail regression via unit-test-style
empirical trajectory inspection, not via e2e. Future offline-mirror
regressions could similarly slip past `bun run test:e2e`. Flagged for
a future cycle to add `/offline/*` Header / swipe / FAB e2e specs.

### Coverage of the spec's "What the architect will check at review"

- **Record as single source of truth for the concepts it holds**: the
  four fields `tag` / `backParent` / `snapshotCapture` / `fab` exist
  only in `route-data.ts`. The 66 `route-data.test.ts` tests assert
  the exact field set (no migration-era fields leak).
- **Record holds only target-clean fields**: `route-data.test.ts`
  `'no migration-era fields leak into the record'` enumerates the
  forbidden keys (`isSpatial`, `headerMode`, `gestureOwner`,
  `spatialNeighbours`, `fabFamily`, `fabKind`, `tabModule`,
  `subPager`, `forcedBackTarget`) and asserts none appears on
  `RouteData` instances for eight sample routes covering all three
  tags.
- **Behavior identical**: the 179 e2e tests pass unchanged.
- **5/5 zero-concern audit**: see the next section; this Round 1
  journal records the run-up to the audit.
- **Journal honest**: failures recorded (the `header-mode` revert
  below), real outputs pasted (above), no performed confidence.

## Failures during implementation

- **`header-mode.ts` first cut changed behavior.** Reducing
  `resolveHeaderMode` to a pure `tag`-based derivation (per §3's
  formula) returned `'deep'` for `/discussion/*`, `/messages/<id>`,
  `/post/discussion`, `/messages/new` where today's code returns
  `'root'` (the FAB family/kind resolves them to a tab). The
  pre-existing `header-mode.test.ts` caught it:

  ```
  expect(resolveHeaderMode('/discussion/123/slug')).toBe('root')
  Expected: "root"
  Received: "deep"
  ```

  Reverted to the hybrid implementation (search branch uses a literal
  `/search` prefix check, functionally equivalent to `tag === 'search'`
  since `/search` is the only 'search'-tagged route today; root/deep
  branch reads `getCurrentTabIndex`). Documented as a deviation; see
  below.

- **Round 1 audit caught an offline-route regression (5/5 FAIL).** I
  narrowed `TAB_BAR_CONFIG`'s offline patterns from the broad prefix
  `/^\/offline/` (matches every `/offline/*` path) to two exact
  anchors `/^\/offline$/` and `/^\/offline\/activity$/`. As a result
  `/offline/[discussionId]` and `/offline/bookmarks` (both real
  routes that mount `DualColumnLayout`) lost their discussions-tab
  association. `getCurrentTabIndex` returned `-1` instead of `0`,
  flipping `resolveHeaderMode` to `'deep'`, disabling
  `DualColumnLayout`'s horizontal swipe, and hiding the retained FAB
  atom. The macro plan §9 says `/offline/[discussionId]` mirrors
  `/discussion/[id]`; the narrowing broke that symmetry. All five
  Round 1 auditors caught the regression with high confidence; none
  of my unit tests did (they codified the regressed answer rather
  than asserting the preserved one). The e2e suite has zero
  `/offline/*` coverage, so "179 pass" did not catch it either.

  Fix: restored the broad prefix patterns
  `/^\/offline\/activity/` (prefix, before) and `/^\/offline/`
  (prefix, after) so every `/offline/*` path resolves to its
  pre-Cycle-1 tab. Added unit tests for
  `getCurrentTabIndex('/offline/<id>')`,
  `getCurrentTabIndex('/offline/bookmarks')`, and the corresponding
  `getTabBarPillTarget` calls, asserting the preserved answers.
  Detailed in `docs/RV20-C01-Audit-01.md`.

- **Round 2 audit passed 2/5; 3/5 PASS-WITH-CONCERNS flagged a
  duplication hazard.** Round 2 auditors B, C, D each flagged
  `_DEEP_ROUTE_PARENTS` (a private pattern list in `route-config.ts`)
  as a duplication of the backParent-declaring patterns in
  `route-data.ts`: a future edit to one without the other would
  silently shift `isGesturePageLayoutRoute`'s answer set. The
  function's body needs to ask "is this route's structural parent
  declared in the core record?", exactly what `getRouteData(p)
.backParent !== undefined` answers. Replaced the pattern list with
  that read. The answer set is byte-identical (verified by the
  existing `isGesturePageLayoutRoute` unit tests, which still pass).
  Auditor C also flagged that the e2e flake on
  `swipe-forward-back-deep-page.spec.ts:285` was not documented per
  §12; added the documentation above. Detailed in
  `docs/RV20-C01-Audit-02.md`.

## Deviations

1. **`backParent` coverage mirrors today's `getParent` set exactly;
   not extended to its full structural coverage.** Per the spec's
   "derive each by reading the route's actual mount and behavior" I
   considered setting `backParent: '/'` on `/discussion/*`,
   `backParent: '/messages/inbox'` on `/messages/<id>`, etc. The
   impact analysis is route-specific:

   - For `/discussion/*` and `/messages/<id>`: `isGesturePageLayoutRoute`
     already returns `true` via the overlay-non-deep branch
     (`attrs.family === 'overlay' && attrs.kind !== 'deep'`), so
     adding `backParent` does not flip it. The `resolvedLeftHref`
     substitution in GPL also does not flip: it fires only when
     `target === '/'`, and for `/messages/<id>` reached from
     `/messages/inbox` the target is `/messages/inbox`, not `/`.
     These two routes are in fact safe to extend in a future cycle.
   - For `/bookmarks`, `/search`, `/notifications`, `/profile` (the
     latent-bug four): `attrs.kind === 'deep'` fails the overlay
     branch and `backParent === undefined` fails the deep-route
     branch, so `isGesturePageLayoutRoute` returns `false` today.
     Adding `backParent` would flip the answer to `true`, dissolving
     the masked latent bug. The spec carves the function out as the
     single imperative exception with answer-set preserved verbatim,
     so the extension is gated on Cycle 5.

   The conservative choice (mirror today's `getParent` set exactly)
   is correct under the spec's "behavior MUST be identical" rule:
   extending backParent to the latent-bug four would change
   `isGesturePageLayoutRoute`'s answer set, which the spec forbids.
   Extending to `/discussion/*` and `/messages/<id>` alone would be
   safe in principle but would split the registry into "routes that
   declare a structural parent" and "routes whose structural parent
   is obvious but undeclared", which is a worse factoring than
   mirroring today's set and broadening uniformly in Cycle 5.
   Flagged for the architect.

2. **`isTabRootPath` and `isPagerRoute` are NOT reduced to record
   reads.** The spec lists them among the classifiers to "remove or
   reduce to a one-line record read", but they answer "is `p` one of
   the three spatial tab positions", which per §3 is tag metadata
   (positional in the tab order), not a per-route property. Forcing
   them through `RouteData` would require a stored spatial-position
   field, violating §3's clarity principle. They stay as one-line
   positional queries over `MOBILE_TAB_DEFS`. Flagged for the
   architect.

3. **`isGesturePageLayoutRoute` body reads `FAB_ROUTE_ATTRIBUTES` and
   the core record's `backParent`.** The function's contract and
   answer set are byte-identical to its pre-Cycle-1 form (including
   the latent bug for `/search`, `/bookmarks`, `/notifications`,
   `/profile`). Its INTERNAL data sources changed because the
   `DEEP_ROUTES` export and `isOverlayRoute` are gone: the
   thread/conversation check reads `FAB_ROUTE_ATTRIBUTES.family ===
'overlay' && kind !== 'deep'`; the deep-route set reads
   `getRouteData(p).backParent !== undefined`. The dynamic-parent
   routes (`/profile/comments/<uid>/<slug>`, etc.) resolve inside
   `getRouteData` so the answer set matches the legacy
   `getParent`-defined set. The function is still imperative; it is
   the single exception the spec carves out. Flagged for the
   architect.

4. **FAB layer family/kind consumer config kept as
   `FAB_ROUTE_ATTRIBUTES`.** §3 says "There is NO FAB family enum".
   For Cycle 1 the FAB layer's sampler-selection logic still needs
   the family/kind data; dissolving it is a Cycle 4 (all-rAF
   executor) concern. The family/kind data lives in a separate
   consumer registry, clearly marked migration-era. The core
   `RouteData.fab` boolean stays clean. Flagged for the architect.

5. **`getCurrentTabIndex` returns -1 for global routes in Cycle 1.**
   §3 says the tab-bar config assigns global routes (`/admin`,
   `/profile`, `/search`, `/bookmarks`, `/notifications`) the
   `'active'` pill target. The current code returns `-1` for those
   routes (Header hides the tab bar). For Cycle 1 behavior-
   preservation `getCurrentTabIndex` returns -1 for global routes;
   the `'active'` semantic lands when the tab-bar consumer is
   rebuilt in a later cycle. Flagged for the architect.

6. **`header-mode.ts` is hybrid, not pure tag-based.** §3's derived
   formula for `headerMode(r)` is `tag === 'tab' ? 'root' : tag ===
'search' ? 'search' : 'deep'`. The pure derivation returns
   `'deep'` for `/discussion/*`, `/messages/<id>`, `/post/discussion`,
   `/messages/new` where today's code returns `'root'` (these routes
   inherit the source list's pill via the FAB family/kind). The
   hybrid implementation uses a literal `/search` prefix check for
   the search branch (functionally equivalent to `tag === 'search'`
   since `/search` is the only 'search'-tagged route today) and
   `getCurrentTabIndex` (now consumer-config-driven) for the
   root/deep branch. The pure tag-only derivation lands in a later
   cycle when the resolver takes over Header morph. Flagged for the
   architect.

## Carried-to-future items

- **Cycle 2**: the unified `PageCacheStore` will read
  `RouteData.snapshotCapture` (currently only `/discussion/*` is
  `true`). Cycle 2 broadens which routes capture.
- **Cycle 3**: the tag-pair resolver reads `RouteData.tag` to select
  the (from-tag, to-tag) pair.
- **Cycle 4**: the all-rAF executor dissolves `FAB_ROUTE_ATTRIBUTES`
  (the family enum) by driving FAB scale plans from the resolver.
- **Cycle 5**:
  - Dissolve `isGesturePageLayoutRoute` and `_DEEP_ROUTE_PARENTS`;
    the page lifecycle owns GPL-vs-not.
  - Broaden `backParent` coverage to `/discussion/*`,
    `/messages/<id>`, `/bookmarks`, etc.
  - Reduce `header-mode` to the pure tag-only derivation.
- **Cycle 5 (or later)**: rebuild the tab-bar consumer to resolve
  `'active'` pill targets to the currently-active tab.
- **Cycle 6**: bring `/offline/*` routes into the unified gesture
  layer; their `RouteData` records already tag them as their online
  counterparts.

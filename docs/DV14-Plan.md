# DV14 - Swipe-back preview cache freshness

## 1. Goal

The mobile swipe-back preview (and the thread-page sidebar) must reflect the
latest server data on every route, including deep pages.

Today the preview's data source — the `list-cache` singleton — is fed only on
the three tab roots. Any `page.data` refresh that fires on a deep page (an
`invalidate`, or the implicit navigation that accompanies returning a PWA to the
foreground) re-runs the root layout load and refreshes `page.data`, but never
writes `list-cache`, so the preview keeps rendering stale cache content while the
freshly-navigated landing renders fresh `page.data`. Preview ≠ landing, on all
three tabs.

This plan fixes the structural mismatch by feeding `list-cache` from a surface
that runs on every route, while keeping the active tab's page-load preference
constrained to tab roots so route-specific list data cannot pollute the shared
cache.

## 2. Confirmed requirements (owner-locked)

- Preview content must match the landing tab's content after a refresh, on every
  route, for all three tabs (discussions / activity / messages).
- No new invalidate or refresh code paths. Reuse the existing root-layout load
  (`+layout.server.ts` calls `depends('app:badges')` and eager-loads all three
  tabs on every route) as the single freshness signal.
- No regression to the tab-to-tab swipe (`MobileTabPager`, which reads `data`
  directly, not `list-cache`) or to on-tab-root behavior.
- The cache must never hold route-specific list data (search results, category or
  profile filters); only page-1-of-the-tab data (the eager-loaded `data.*`) or the
  active tab's own page-load data on its tab root.
- The fix is centralized — one write site — so every `list-cache` reader is
  corrected together.

## 3. Architecture context (verified inventory)

### 3.1 The freshness signal

`src/routes/+layout.server.ts` (the root load) eager-loads page 1 of all three
tabs on EVERY route and calls `depends('app:badges')` (line 37). On
`invalidate('app:badges')` or `invalidateAll()` this load re-runs and
`data.home` / `data.activity` / `data.messages` refresh reactively inside every
layout component. The existing badges seed effect (`+layout.svelte`) relies on
exactly this reactivity, so the mechanism is proven.

The refresh has no explicit foreground listener. A full-repo grep finds no
`visibilitychange` / `focus` / `pageshow` / `message` handler that invalidates.
The refresh observed when a PWA returns to the foreground is an implicit side
effect of a navigation on resume (the SW `push` → `notificationclick` →
`focusOrOpenClient(targetUrl)` path in `src/service-worker.ts:132-153` navigates
the PWA to a target URL, or the OS restores it), which re-runs the root load.
This is independent of the defect: ANY invalidate path triggers it, and the
defect must be fixed regardless of trigger.

### 3.2 The preview data source (readers)

- `list-cache` singleton (`src/lib/stores/list-cache.svelte.ts`): holds
  `#state.{discussions,activity,messages}`, written only via
  `setDiscussions` / `setActivity` / `setMessages`. It has no invalidation
  method.
- READ by `MOBILE_TABS[tab].panel` (`src/lib/utils/route-config.ts:361-366` —
  `MOBILE_TABS` and `TAB_LIST_PANELS`) — the `TabDiscussionsPanel` /
  `TabActivityPanel` / `TabMessagesPanel` wrappers, each
  `$derived(cache.X?.items ?? page.data.X)` (cache first).
- READ by the thread-page sidebar
  (`src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte:559-573`).
- `GesturePageLayout.getPreviewPanel`
  (`src/lib/components/templates/GesturePageLayout.svelte:71-75`) falls back to
  `MOBILE_TABS[activeTab].panel` when the back target is a tab root, so the
  deep-page → tab-root swipe-back preview is a `list-cache` reader.
- The search scope pager (`SearchScopePager.svelte`) reads a SEPARATE
  `search-cache` store (`getSearchCacheStore`), not `list-cache`; it is
  unaffected by this fix.

### 3.3 The current write surface — the defect

`src/routes/(tabs)/+layout.svelte:52-60` runs an `$effect` that writes
`list-cache`, but it is gated on `page.url.pathname ∈ {/, /activity,
/messages/inbox}`. Deep pages (`/discussion/*`, `/messages/[id]`, `/profile/*`,
`/admin/*`, `/bookmarks`, `/search`, `/notifications`, ...) are top-level routes
that do NOT mount `(tabs)/+layout.svelte`, so the effect never runs there and the
cache is never fed on a deep page.

The cache's write surface (route-gated `(tabs)` layout) is narrower than its read
surface (every preview, on every route). The root layout already eager-loads all
three tabs on every route specifically so previews have data, but that data lands
in `page.data` while the cache only captures it on tab roots.

That pathname gate also incidentally protected a second invariant the fix must
preserve: `page.data.X` is only the active tab's list field on its own tab root.
Several non-tab routes return a same-named field with different semantics
(`/search`, `/category/*`, `/profile/*`), and the gate kept them out of the cache.
The fix must keep that protection while still feeding the cache on deep pages.

### 3.4 What is NOT affected

`MobileTabPager` (`src/lib/components/templates/MobileTabPager.svelte:280-311`)
reads the reactive `data` prop directly (active tab `page.data.X ?? data.X`,
neighbours `data.X`), NOT `list-cache`. The tab-to-tab swipe preview is therefore
already fresh on a refresh. Out of scope.

### 3.5 e2e instrumentation (already in place, dev-only)

Root `+layout.svelte` exposes `__e2eCacheWrites` (a setter-call log),
`__e2eInvalidateBadges()`, and `__e2eListCache` behind `import.meta.env.DEV`
(matching the existing `__e2eGoto` / `__navReady` convention).
`e2e/list-cache-stale-after-refresh.spec.ts` reproduces the defect: Test 1 and
Test 2 fail on current code and pass once the cache is fed on every route; Test 3
is a post-refresh back-swipe navigation guard with a diagnostic frame log.

## 4. Design

### 4.1 Central fix: feed list-cache from the root layout, page-data preference gated to tab roots

Move the cache-feeding `$effect` out of the route-gated `(tabs)/+layout.svelte`
into `src/routes/+layout.svelte`, which mounts on every route and already holds
the reactive `data` prop. Drop the pathname guard around the effect body, but
keep the page-data preference constrained to tab roots via `isTabRootPath`
(`src/lib/utils/history-nav.ts:37`, already imported in the root layout; true for
exactly `/`, `/activity`, `/messages/inbox`). Without that constraint, non-tab
routes that return a same-named field with different semantics would pollute the
cache (see §6).

Add at the script top level of `src/routes/+layout.svelte`, next to the other
store consts:

```js
const listCache = getListCacheStore();
```

and the effect, alongside the other seed effects:

```js
$effect(() => {
    // data.home/activity/messages are eager-loaded by +layout.server.ts on every
    // route and refresh whenever the root load re-runs. Feeding list-cache here
    // (not in the route-gated (tabs) layout) keeps the swipe-back preview in sync
    // with page.data on deep pages too. The page-data preference is constrained to
    // tab roots: elsewhere page.data.X may be a same-named but semantically
    // different field (search results, category/profile filters) that must NOT
    // enter the shared cache, so only the eager-loaded data.* fallback is used.
    const onTabRoot = isTabRootPath(page.url.pathname);
    listCache.setDiscussions(onTabRoot && page.data.discussions ? page.data : data.home);
    listCache.setActivity(onTabRoot && page.data.activities ? page.data : data.activity);
    listCache.setMessages(onTabRoot && page.data.conversations ? page.data : data.messages);
});
```

On a tab root the active tab's page-load data is written (preserving its `?page`
pagination); the other two slots fall through to `data.*` page-1. On every other
route — deep pages and the paginated `/discussions/pN` — only the `data.*`
fallback is written, so the cache is fed everywhere (the fix) without being
polluted by route-specific list data.

### 4.2 Why an effect, not a derived or a store binding

The current write is already an `$effect`; relocating it is the minimal change
with the lowest risk. `setDiscussions` mutates the store but the effect does not
read the store back, so there is no loop (it mirrors the badges seed effect). A
`$derived` cannot host the write (deriveds must be pure); introducing a reactive
store binding (`$effect.pre` assignment) would add a new pattern for no gain.

### 4.3 Reactivity and write traffic

`data` is the layout's reactive prop; `page.data` is `$app/state`. The effect
tracks `page.url.pathname` (the gate) and, conditionally, `page.data.X` (read only
on a tab root, via short-circuit) or `data.X` (read off a tab root). It re-runs on
invalidate (the `data.*` values change → the cache refreshes) and also on
navigation (the pathname changes). The extra navigation writes carry the same
`data.*` page-1 content, and each panel's `$derived(cache.X?.items)` is
reference-stable across those writes (the `items` array is the same `data.X`
array), so there is no meaningful re-render churn. This is strictly more write
traffic than the route-gated original, but it is idempotent in content and cheap.

### 4.4 Blast radius

The fix is one write site. Every `list-cache` reader (§3.2) is corrected together
— no per-reader edits. `MobileTabPager` (§3.4) is untouched. The write is always
page-1-of-the-tab (`data.*`), except on a tab root where the active tab's
page-load data wins; the `isTabRootPath` gate guarantees no route-specific list
data (search results, category/profile filters) enters the cache.

### 4.5 Post-refresh back-swipe track-reveal anomaly (UNVERIFIED — out of scope for C00)

`e2e/list-cache-stale-after-refresh.spec.ts` Test 3 records `peak m41 = 0` over
73 frames when a back-swipe follows a refresh on a thread page: the gesture
commits to `/` but the during-drag track reveal is absent. This is a positional
gesture symptom, independent of the data staleness; the cache fix does not
address it. Its cause is not pinned, and the headless invalidate-then-swipe
simulation may not reproduce the real refresh-during-gesture timing. Carried as
UNVERIFIED and deferred to a separate investigation. It does not block the
cache-freshness fix.

## 5. Files

- `src/routes/+layout.svelte` — ADD `const listCache = getListCacheStore();` at the
  script top level (next to the other store consts); ADD the cache-feeding
  `$effect` (§4.1). `getListCacheStore` and `isTabRootPath` are already imported
  here.
- `src/routes/(tabs)/+layout.svelte` — REMOVE the cache `$effect` (lines 52-60),
  the `getListCacheStore` import (line 29), and the `listCache` const (line 39).
- `e2e/list-cache-stale-after-refresh.spec.ts` — no change. Test 1 and Test 2
  flip green; Test 3 is unchanged.

## 6. Edge cases & risks

- **Cache pollution prevented.** `isTabRootPath` gates the `page.data.X`
  preference to the three tab roots. Routes that return a same-named field with
  different semantics (`/search` → `DiscussionSearchItem[]`, `/category/*`,
  `/profile/discussions/*`, `/profile/*`) never reach the cache; the `data.*`
  fallback is used there.
- **Tab-root behavior.** On a tab root the active tab's page-load data wins
  (pagination preserved). The two non-active slots are written with `data.*`
  page-1 (they went unwritten before). This matches `MobileTabPager`, which
  already renders non-active tabs from page-1 layout data, so preview and landing
  stay consistent.
- **Paginated non-active tab (acknowledged minor edge).** A non-active tab
  paginated to `?page=N` whose cache was captured at its tab root is overwritten
  with page-1 once the user enters a deep page (the effect writes the `data.*`
  fallback there). If the user then browser-backs to `?page=N`, the preview shows
  page-1 while the landing renders page-N. This is the same single-slot-cache
  limitation as the original defect, but a far narrower trajectory (paginate →
  deep detour → back-to-?page=N). A proper fix needs per-page cache keying and is
  deferred; the current fix is net-positive (it resolves the common
  invalidate-on-deep-page staleness covered by Test 1/Test 2).
- **Auth routes.** On `/entry/*` the root layout still mounts; the root load
  returns the empty `EMPTY_*` shapes for guests, so the effect writes empty
  arrays. The panels treat an empty cache as unpopulated (`isPopulated` /
  `items.length`) and fall back to `page.data`, so there is no visible effect.
- **Badges-only invalidate on a tab root.** `invalidate('app:badges')` re-runs
  only the root load, not the tab page load, so `page.data.X` on a tab root is the
  reused page-load array. The cache therefore holds that array, not the freshly
  eager-loaded `data.X`. This matches the current `(tabs)` behavior exactly
  (preview and landing read the same array, so they still match); it is not a
  regression.
- **Effect loop.** None — the effect writes to a store it does not read.
- **First paint / SSR.** Effects are client-only; the cache was already
  client-only; panels fall back to `data` / `page.data` on SSR.

## 7. Testing plan

- `e2e/list-cache-stale-after-refresh.spec.ts`:
  - Test 1 (on a tab root, a refresh rewrites all three caches) — flips green.
  - Test 2 (on a deep page, a refresh rewrites all three caches) — flips green.
  - Test 3 (post-refresh back-swipe navigation guard) — stays green.
- No new unit test: the fix is an `$effect` over `$state` (runes) code, which
  `bun:test` cannot load (memory `bun-test-no-runes-loader`); e2e is the correct
  level.
- Run the full mobile e2e suite to guard regressions (swipe-back,
  tab-exit-preview, enter-animation, search-enter-exit-asymmetry).
- `bun run check` for type/lint (the project's zero-inline-typing rule applies).

## 8. Out of scope

- The post-refresh track-reveal anomaly (4.5).
- Any new explicit foreground-refresh hook (the defect is independent of trigger).
- `MobileTabPager` (already reads fresh `data`).
- Per-page cache keying for the paginated-non-active-tab edge (§6).

## 9. Verified items

- The root-layout `data` prop is reactive to `invalidate('app:badges')`: the
  existing badges seed effect in the same file uses the identical mechanism.
  Confirmed by 5/5 auditors in round 1.
- Removing the `(tabs)` effect leaves no dangling reference: `listCache` appears
  only at the import, the const, and inside the doomed `$effect`. Confirmed by
  5/5 auditors in round 1.

## Round 1 revision (post RV14-Plan-Audit-01)

Round 1 tally: 2 PASS, 3 changes_requested (not 5/5). Two blocking issues, both
adopted:

- **B1:** explicitly add `const listCache = getListCacheStore();` at the root
  layout's script top level. The round-1 snippet referenced an identifier that was
  only in scope inside the dev e2e block.
- **B2 (cache pollution):** gate the `page.data.X` preference on
  `isTabRootPath(page.url.pathname)`. Without it, `/search`, `/category/*`, and
  `/profile/*` would write semantically different same-named fields into the shared
  cache. The `data.*` fallback stays unguarded so deep pages are still fed.

Documentation corrections adopted: §3.2 SearchScopePager removed (it reads
`search-cache`, not `list-cache`); §4.3 rewritten (the effect re-runs on
navigation; writes are idempotent and reference-stable, not "no spurious write");
§4.1/§4.4 wording corrected; §6 adds the paginated-non-active-tab edge (deferred),
the `/entry` empty-array note, and the badges-only-invalidate note; §9 UNVERIFIED
items resolved (proven by the badges effect pattern).

# RV14-Plan-Audit-01 - Plan audit round 01

Five independent open-ended auditors (no roles, no steering, read-only, no e2e, no
git mutation) reviewed `docs/DV14-Plan.md` against the code.

## Tally

| Auditor | Verdict           |
| ------- | ----------------- |
| 1       | changes_requested |
| 2       | PASS              |
| 3       | changes_requested |
| 4       | changes_requested |
| 5       | PASS              |

**2 PASS / 3 changes_requested → round 1 FAIL (not 5/5).**

## Blocking issues (deduplicated)

### B1 - the snippet references an undefined `listCache`

`src/routes/+layout.svelte` has the `getListCacheStore` import and a `const store`
scoped inside the dev e2e block, but no top-level `listCache` const. The §4.1
snippet (`listCache.setDiscussions(...)`) would throw `ReferenceError`. (Found by
auditors 1, 3.)

**Fix:** explicitly add `const listCache = getListCacheStore();` at the script top
level of the root layout.

### B2 - cache pollution from non-tab routes that return same-named fields

The original plan removed the pathname gate but kept the loose
`page.data.X ? page.data : data.X` ternary. Several top-level routes return a
top-level `discussions` / `activities` / `conversations` field with DIFFERENT
semantics, and the de-gated ternary would write that route-specific data into the
shared cache, then a swipe-back preview would render it through the list panel
(broken UI until commit). Contaminating routes verified by auditors 3 and 4:

- `/search` → `DiscussionSearchItem[]` / `ActivitySearchItem[]` / `MessageSearchItem[]`
  (`search/+page.server.ts`) - has `bodyPreview`/`matchKind`/`rank`, lacks
  `viewCount`/`isPinned`/`isBookmarked`/`unreadCount`/`lastReplyAuthor*`.
- `/category/[categorySlug]` → category-filtered `discussions`.
- `/profile/discussions/[userId]/[userSlug]` → a single author's `discussions`.
- `/profile/[userId]/[userSlug]` → profile-feed-shaped `activities`.

**Fix:** gate the `page.data.X` preference on `isTabRootPath(page.url.pathname)`
(`src/lib/utils/history-nav.ts:37`, already imported in the root layout; true for
exactly `/`, `/activity`, `/messages/inbox`). The `data.*` fallback stays
unconditional so deep pages are still fed (the actual fix):

```js
const onTabRoot = isTabRootPath(page.url.pathname);
listCache.setDiscussions(onTabRoot && page.data.discussions ? page.data : data.home);
listCache.setActivity(onTabRoot && page.data.activities ? page.data : data.activity);
listCache.setMessages(onTabRoot && page.data.conversations ? page.data : data.messages);
```

## Notable concerns (non-blocking)

- **§3.2 inventory:** `SearchScopePager` reads the separate `search-cache` store
  (`SearchScopePager.svelte:32,47` → `getSearchCacheStore`), not `list-cache`.
  Flagged by all five auditors. The true `list-cache` readers are the three
  `Tab*Panel` wrappers, the thread sidebar, and `GesturePageLayout.getPreviewPanel`
  via `MOBILE_TABS[].panel`.
- **§4.3 "no spurious write":** wrong. The effect reads `page.data.X` and
  `page.url.pathname`, so it re-fires on every navigation, not only on invalidate.
  Writes are idempotent and reference-stable (each panel's `$derived(cache.X?.items)`
  sees the same `data.X` array across plain-nav writes), so no real churn - but the
  rationale as written was incorrect. (Auditors 1, 2, 4, 5.)
- **C2 - paginated non-active tab clobber (auditor 5):** a non-active tab paginated
  to `?page=N` whose cache was captured at its tab root is overwritten with page-1
  once the user enters a deep page; browser-back to `?page=N` then shows a page-1
  preview vs page-N landing. Same single-slot-cache limitation as the original
  defect, much narrower trajectory. Net-positive; acknowledged, deferred (per-page
  cache keying).
- **C3 - `/entry/*` empty arrays (auditor 4):** the root load returns `EMPTY_*` for
  guests, so the effect writes empty arrays on auth routes. Panels treat empty as
  unpopulated and fall back to `page.data`; no visible effect. Worth a sentence.
- **C4 - badges-only invalidate on a tab root (auditor 5):** `invalidate('app:badges')`
  re-runs only the root load, not the tab page load, so `page.data.X` on a tab root
  is the reused page-load array (stale vs the freshly eager-loaded `data.X`). Matches
  current behavior exactly (preview and landing read the same array); not a regression.
- **§4.1/§4.4 "identical":** the new effect writes all three slots on every fire;
  non-active tabs are additionally refreshed to layout page-1 (matching
  `MobileTabPager`). The wording overstated equivalence. (Auditors 1, 2, 3.)

## Verified-clean (carry forward, consensus)

- Root-layout `data` is reactive to `invalidate('app:badges')` - proven by the
  existing badges seed effect using the same `data` prop (all five).
- No effect loop - the effect writes `list-cache` but reads no `list-cache` field
  (all five).
- `MobileTabPager` reads the reactive `data` prop, not `list-cache`; tab-to-tab
  swipe is unaffected (all five).
- `MOBILE_TABS[tab].panel` resolves to the three `Tab*Panel` wrappers (cache-first
  readers); `GesturePageLayout.getPreviewPanel` falls back to it for back-to-tab-root.
- Removing the `(tabs)` effect leaves no dangling reference - `listCache` appears
  only at the import, the const, and inside the doomed `$effect` (all five).
- `getListCacheStore` is already imported in the root layout; `isTabRootPath` is
  already imported there too.
- SSR safe - `$effect` is client-only; cache was already client-only.
- `__e2eCacheWrites` wrap captures writes regardless of caller, so the relocated
  effect's writes are logged identically.

## Revision decisions

Adopt B1 and B2 (the gate). Correct §3.2 (drop SearchScopePager), §4.3 (reactivity
framing), §4.1/§4.4 (wording), §6 (add C2/C3/C4 notes, soften "no spurious write"),
§5 (add the `const listCache` line), §9 (resolve the UNVERIFIED items - proven by
the badges effect pattern). Re-audit in round 2.

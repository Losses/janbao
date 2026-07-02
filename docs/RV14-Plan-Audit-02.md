# RV14-Plan-Audit-02 - Plan audit round 02

Five independent open-ended auditors (fresh prompts, no round-1 context, read-only,
no e2e, no git mutation) reviewed the revised `docs/DV14-Plan.md`.

## Tally

| Auditor | Verdict |
| --- | --- |
| 1 | PASS |
| 2 | PASS |
| 3 | PASS |
| 4 | PASS |
| 5 | PASS |

**5/5 PASS → round 2 PASS. Plan approved for implementation.**

## Blocking issues

None.

## Notable concerns (non-blocking, carried into implementation)

- **Type narrowing at root scope (auditors 2, 3).** `page.data` in the root layout
  is the global `App.PageData` union (includes `SearchLoadData` whose `discussions`
  is `DiscussionSearchItem[]`, incompatible with `DiscussionListItem[]`). The
  runtime gate `onTabRoot && page.data.discussions` does not narrow the union. If
  `bun run check` errors on `setDiscussions(page.data)`, resolve with a named cast
  (`DiscussionsCacheInput`) or an explicit object - verify empirically at impl.
- **§3.1 trigger framing (auditors 2, 3).** The PWA-return-to-foreground navigation
  is one speculative trigger; the concrete invalidate paths in prod are
  `invalidate('app:badges')` in `messages/[id]` afterNavigate and the `invalidateAll`
  sites. Non-load-bearing - the plan's "regardless of trigger" caveat holds.
- **§6 auth-routes wording (auditors 1, 3, 4).** `??` does not fall back on `[]`
  (only nullish); the empty-array write on `/entry/*` is moot (AppShell suppressed
  there). Also guests DO get real discussions (guest-readable); only activity and
  messages fall back to empty for guests. Documentation imprecision, no visible
  effect.

## Invalid concerns (auditor error, not adopted)

- **"mobile-tabs.ts does not exist" (auditors 1, 4).** `src/lib/utils/mobile-tabs.ts`
  exists (108 lines; `MOBILE_TABS` at lines 62-70, `.panel` at line 59, `.checkCache`
  / `.hasData` at 66-68). `(tabs)/+layout.svelte:26` imports `getCurrentTabIndex`
  from `'$lib/utils/mobile-tabs'`. Git status shows the file modified, not deleted.
  The §3.2 citation is correct.

## Verified-clean (round-2 consensus)

- `data` reactive to `invalidate('app:badges')` via the badges seed effect pattern.
- `isTabRootPath` matches exactly `{/, /activity, /messages/inbox}` (history-nav
  unit test asserts the set) and excludes the four contaminating routes plus
  `/discussions/pN`, `/messages/[id]`, `/discussion/*`.
- The gated ternary prevents pollution on `/search`, `/category/*`,
  `/profile/discussions/*`, `/profile/*` (all `onTabRoot=false` → `data.*` fallback).
- No effect loop; short-circuit tracking correct.
- Removing the `(tabs)` effect leaves no dangling reference.
- Reader inventory complete: three `Tab*Panel` wrappers, thread sidebar,
  `GesturePageLayout.getPreviewPanel` via `MOBILE_TABS[].panel`.
- `MobileTabPager` reads `data`/`page.data`, not list-cache; out of scope.
- `getListCacheStore` and `isTabRootPath` already imported in the root layout.
- `__e2eCacheWrites` captures the relocated effect's writes regardless of caller.

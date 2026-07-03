# RV14-C00-Audit-01 - Implementation audit round 01

Five independent open-ended auditors reviewed the C00 implementation (the actual
`git diff`) against the approved plan and journal. Auditor 3 died on a terminal
API error and was re-run as 3b; both count as one seat.

## Tally

| Auditor       | Verdict      |
| ------------- | ------------ |
| 1             | PASS         |
| 2             | PASS         |
| 3 (API error) | re-run as 3b |
| 3b            | PASS         |
| 4             | PASS         |
| 5             | PASS         |

**5/5 PASS → C00 round 1 PASS. Implementation accepted.**

## Blocking issues

None.

## Notable concerns (non-blocking, adopted where trivial)

- **Stale comment in `src/routes/+layout.svelte`** (auditor 5): the dev-block
  setter-wrap comment referenced "(tabs) layout" as a caller, but `(tabs)` is no
  longer a cache writer. Refreshed to name the current caller (the root-layout
  feeding effect). Also satisfies the no-history-comments rule.
- **Misleading e2e titles** (auditor 3b): Test 1's (and, by parity, Test 2's)
  `test(...)` title described the _defect_ ("rewrites ONLY the current tab";
  "rewrites NO cache") rather than the behaviour the body asserts (all three
  rewrite). Renamed both to describe the fixed behaviour the bodies assert.
- **Empty-array write on `/entry/*`**: `setDiscussions` guards on
  `if (data?.discussions)`, truthy for `[]`, so the `EMPTY_*` shapes write empty
  slots; `isPopulated` (`!!items.length`) treats them as unpopulated so panels
  fall back. Plan §6 reasons about this; no visible effect. Not adopted (moot).
- **Plan §6 auth-routes `??`-on-`[]` wording** (auditors 1, 3, 4): `??` does not
  fall back on `[]`. Documentation imprecision, no visible effect. Not adopted.
- **Type-narrowing at root scope** (carried from plan round 2): confirmed
  empirically - `bun run check` is 0/0; `setDiscussions(page.data)` type-checks.

## Verified-clean (consensus)

- The new root-layout `$effect` matches plan §4.1 verbatim: gated on
  `isTabRootPath(page.url.pathname)`, writes all three setters, `page.data`
  preference gated, `data.*` fallback unguarded. `const listCache` at top level.
- `(tabs)/+layout.svelte` fully cleaned (import, const, effect removed); zero
  grep hits.
- `isTabRootPath` matches exactly `{/, /activity, /messages/inbox}`; excludes the
  four contaminating routes (`/search`, `/category/*`, `/profile/*` ×2) and
  `/messages/[id]`, `/discussion/*`, `/discussions/pN`.
- No effect loop (writes `listCache`, reads no `listCache` field).
- No other production write site for list-cache (only the root effect + dev e2e
  wrappers; `SearchScopePager` uses a separate `search-cache`).
- All readers covered: three `Tab*Panel` wrappers, thread sidebar,
  `GesturePageLayout.getPreviewPanel` via `MOBILE_TABS[].panel`.
- `MobileTabPager` reads `data`, not list-cache; unaffected.
- Concurrent `mobile-tabs → route-config` consolidation (commit 73eafd9) did not
  change `MOBILE_TABS[tab].panel` resolution (still the cache-reading wrappers);
  `isTabRootPath` and `getListCacheStore` unchanged.
- E2E spec assertions match the journal; the `peak m41 = 0` anomaly is logged,
  not asserted, so Test 3 stays green regardless.

## Deviation assessment

Acceptable. The implementation is verbatim with the plan; the only "deviation"
is the concurrent refactor (mobile-tabs → route-config), which the journal
documents as noted-not-deviation and which does not affect the fix's semantics.

## Revision decisions

Adopted the two doc-accuracy cleanups (stale comment, e2e titles). `bun run check`
0/0 and the repro spec 3/3 re-verified after the cleanups. No code-behaviour
change. DV14-C00 is COMPLETE at 5/5.

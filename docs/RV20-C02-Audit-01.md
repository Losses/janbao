# RV20-C02 - Audit Round 01 (2-auditor model)

Two auditors (A, B) examined the Cycle 2 implementation. Result: **0/2 PASS** (A: FAIL, B: PASS-WITH-CONCERNS).

## Critical defect (auditor A, 1/2)

`SearchCacheEntrySource.q` vs `PageCacheSource.query` field-name mismatch. The capture writes `source.query`; `isSearchEntryFresh` read `entry.q` (always `undefined`). Every search entry reported stale; the LoadingChip rendered forever; search results invisible on mobile.

**Root cause:** Deviation 6 relaxed `SearchCacheEntrySource.q` to optional, making `PageCacheSource` assignable without having `q`. TypeScript did not catch the mismatch.

**Fix applied:** renamed `q` to `query` in `SearchCacheEntrySource` + `isSearchEntryFresh` + the test entries. Added two round-trip preventive tests (a `PageCacheSource` with `query` is fresh; without `query` is stale).

## Other concerns (auditor B, secondary)

- **B-A:** `PageCacheStore.ensure`/`registerSource` not directly tested (test simulates inline). Carried to Cycle 3 (ensure is unused in Cycle 2).
- **B-B:** Journal Deviation 5 claims "e2e test semantics unchanged" but the wrap now counts ALL captures (including scroll writes), diluting the signal. Journal to be corrected.
- **B-C:** Per-scroll-capture cost: `captureEntry` runs O(N) eviction on every onscroll. Not a behavior defect; documented as a perf characteristic.

## Fixes applied between R1 and R2

1. `search-fresh.ts`: `q` renamed to `query` (field, parameter, interface).
2. `search-fresh.test.ts`: all entries updated; two round-trip tests added.
3. Journal Deviation 5 + 6 to be corrected for accuracy.

Consecutive pass votes: 0 (both auditors had concerns/defects).

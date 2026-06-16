# RV04-C03-Audit-02: DV04 Cycle 3 - Round 2 Audit (FINAL)

**Date:** 2026-06-16
**Cycle:** C03 - Discovery (Categories + RSS + Search)
**Method:** 5 independent sub-agents re-audited the C03 scope after Round 1 fixes, each performing the full un-roled audit. Reports consolidated below.

**Round 2 Verdicts:** **5× PASS** (unconditional) - Agents 1, 2, 3, 4, 5. All Round-1 fixes CONFIRMED; no regressions; no new actionable defects.
**Consolidated consensus: UNANIMOUS PASS. Audit loop closed.**

---

## 1. Final fix verification (all 5 agents)

- **C3-1**: `src/lib/server/db/dao/search.ts` body-preview fetch now filters `and(inArray(replies.id, bestReplyIds), isNull(replies.deletedAt))` - soft-delete TOCTOU closed (defense-in-depth: the sibling reply-position subquery and the FTS body JOIN also re-filter `deleted_at IS NULL`).
- **C3-2**: `src/routes/category/[categorySlug]/rss/+server.ts` sends `Cache-Control: private, no-store` (+ `X-Content-Type-Options: nosniff`) on the per-user-secret feed.
- **C3-3**: new `getSiteUrl(platformEnv, url)` helper in `src/lib/server/constants.ts` (prefers `SITE_URL` env - added to `PlatformEnv` in `src/app.d.ts` - with request-origin fallback); RSS derives all feed link/guid/self URLs from it. Host-header poisoning of feed URLs closed.
- **Verification gate GREEN** - every agent re-ran `bun run check` (0/0) and `bun run lint` (exit 0); FTS unit tests 5/5.

## 2. Findings raised in Round 2

**None actionable.** All five agents returned unconditional PASS. Non-actionable observations recorded: `search.tooShortHint` is a dead i18n key (cosmetic, cross-cutting → could be cleaned in C07); no upper bound on search `q` length (bounded by URL-length/platform caps; optional clamp). Neither blocks C03.

## 3. Carry-overs (final, accepted for C03)

1. search `totalPages = Math.max(1, ceil(total/limit))` yields 1 not 0 on filtered-to-empty (cosmetic; UI hides the paginator).
2. single-category count short-circuits the readable-slugs filter when `categorySlug` is set (latent; `resolvePermissions.canRead` 403s the whole category first).
3. `/categories` + `/api/categories` inline the readability filter vs `getReadableCategorySlugs` (theoretical admin/mod `canRead=false`; never occurs).
4. `messagesFtsHits` unbounded intermediate FTS scan (perf; participant post-filter bounds it).
5. search reply-position deep-link tiebreaker drift under same-second ties (cosmetic; lands on the right page).
6. (cross-cutting) `search.tooShortHint` dead i18n key → C07 cleanup candidate.

## 4. Round 2 Conclusion

**DV04 Cycle 3 (Discovery) is unanimously considered complete and clean.** All five agents rendered an unconditional PASS; the gate is green; the three Round-1 MINORs are fixed and re-verified; disabled-category propagation, RSS token auth/scoping, search-scope authorization, and FTS read-path injection-safety all hold. The "negative-id cursor" FTS gotcha was confirmed N/A to the read path (offset/limit pagination, rowid↔PK 1:1). **C03 advances. Audit loop closed.**

---

## Appendix: C03 fix summary (Round 1)

- **C3-1 (MINOR):** search discussion body-preview fetch now filters `isNull(replies.deletedAt)` (closes the soft-delete TOCTOU on the preview snippet).
- **C3-2 (MINOR):** category RSS now sends `Cache-Control: private, no-store` on the per-user-secret feed.
- **C3-3 (MINOR):** new `getSiteUrl(platformEnv, url)` helper (SITE_URL env preference) feeds all RSS link/guid URLs - closes Host-header poisoning of feed URLs. `SITE_URL` added to `PlatformEnv`.

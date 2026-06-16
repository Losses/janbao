# DV04-C03-Journal: Cycle 3 Audit Journal - Discovery (Categories + RSS + Search)

## Cycle 3: Discovery (Categories + RSS + Search)

**Date:** 2026-06-16
**Status:** ✅ CLOSED — 5/5 unconditional PASS (Round 2)

---

## 1. Scope

Category listing, single category, category RSS, the categories API, and the search surface (page + DAO + FTS read path):

- `src/routes/categories/+page.server.ts`
- `src/routes/category/[categorySlug]/[[page=page]]/+page.server.ts`
- `src/routes/category/[categorySlug]/rss/+server.ts`
- `src/routes/api/categories/+server.ts`
- `src/routes/search/+page.svelte` (+ the search backend it calls)
- `src/lib/server/db/dao/search.ts`, `src/lib/server/search/**` (FTS read/query/cursor/scope)
- `src/lib/server/constants.ts` (`getReadableCategorySlugs`, `resolvePermissions`, pagination, `getSiteUrl`)

---

## 2. Method

Per DV04-Plan §2: 5 independent sub-agents run the same full un-roled audit; consolidate into `RV04-C03-Audit-[round].md`; advance only on 5/5 unconditional PASS. Gate each round: `bun run check` 0/0 + `bun run lint` exit 0.

---

## 3. Audit Round 1 - 2026-06-16

Consolidated → [RV04-C03-Audit-01.md](./RV04-C03-Audit-01.md).
**Verdicts:** 2× PASS (Agents 4, 5), 3× PASS_WITH_NOTES (Agents 1, 2, 3). **Consensus: not yet unanimous.**

**Issues found and fixed (Round 2 fixes):**

- **MINOR** - Search discussion body-preview fetch (`bodyPreviewMap`) used `inArray(replies.id, …)` without `isNull(replies.deletedAt)`; a reply soft-deleted between the FTS hit and the preview fetch could attach a stale plain-text preview (TOCTOU). Fix: added `isNull(replies.deletedAt)` to the preview query.
- **MINOR** - Category RSS omitted `Cache-Control` on a per-user-secret feed (rssToken in the query string). Fix: added `Cache-Control: private, no-store`.
- **MINOR** - RSS `siteUrl` came from `event.url.host`/`protocol` (client-controllable Host on a proxy/self-host) — feed link/guid URLs could be poisoned. Fix: new `getSiteUrl(platformEnv, url)` helper in `constants.ts` prefers a configured `SITE_URL` env (added to `PlatformEnv` in `src/app.d.ts`), falling back to the request origin.

**Carry-overs (documented, accepted):** search `totalPages` 1-vs-0 on filtered-to-empty (cosmetic, UI hides paginator); single-category count short-circuits readable filter (latent, no live leak — `resolvePermissions.canRead` 403s first); `/categories` + `/api/categories` inline the readability filter vs `getReadableCategorySlugs` (theoretical admin/mod canRead=false); `messagesFtsHits` unbounded intermediate FTS scan (perf, participant post-filter); search reply-position deep-link tiebreaker drift (cosmetic).

**Pre-known verified intact (5/5):** disabled-category propagation on all 4 public surfaces; RSS token auth (122-bit uuid, unique, token-equality lookup, resolvePermissions gate, no IDOR/enumeration); search-scope authorization (readable slugs / recipient-visibility / participant filter); FTS read injection-safety (parameterized MATCH via `cleanFtsQuery`, escaped LIKE, no string SQL); negative-id cursor N/A to the read path (offset/limit, rowid↔PK 1:1); no `DELETE FROM` on contentless tables; i18n 453/453; no `as any`.

**Verification after Round 2 fixes:** `bun run check` 0/0; `bun run lint` exit 0.

**Status:** Round 2 fixes applied and verified. Proceeding to Round 2 re-audit to seek 5/5 unconditional PASS.

---

## 4. Audit Round 2 — 2026-06-16 (FINAL)

Consolidated → [RV04-C03-Audit-02.md](./RV04-C03-Audit-02.md).
**Verdicts:** 5× PASS (Agents 1, 2, 3, 4, 5 — all unconditional). All Round-1 fixes CONFIRMED (C3-1 soft-delete TOCTOU closed, C3-2 Cache-Control, C3-3 SITE_URL getSiteUrl); no regressions; no new actionable defects. Each agent re-ran the gate (`bun run check` 0/0, `bun run lint` exit 0; FTS tests 5/5).

Non-actionable observations: `search.tooShortHint` dead i18n key (→ C07 cleanup); no upper bound on search `q` length (bounded by platform URL caps; optional clamp). Neither blocks C03.

**Status: ✅ UNANIMOUS PASS — C03 audit loop closed.** All five agents consider Cycle 3 (Discovery) complete and clean. The "negative-id cursor" FTS gotcha was confirmed N/A to the read path. C03 converged in 2 rounds.

**Cycle 3 complete. Advancing to Cycle 4 (User Profile).**

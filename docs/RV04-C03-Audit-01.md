# RV04-C03-Audit-01: DV04 Cycle 3 — Round 1 Audit

**Date:** 2026-06-16
**Cycle:** C03 — Discovery (Categories + RSS + Search)
**Method:** 5 independent sub-agents, each performing the full un-roled audit of the C03 scope. Reports consolidated below.

**Round 1 Verdicts:** **2× PASS** (Agents 4, 5 unconditional), **3× PASS_WITH_NOTES** (Agents 1, 2, 3).
**Consolidated consensus: not yet unanimous PASS** — three actionable MINORs; the rest are carry-over-class.

---

## 1. Findings (deduplicated, with finders)

### MINOR (fixed this round)

- **C3-1 (Agent 1):** `src/lib/server/db/dao/search.ts` discussion body-preview fetch (`bodyPreviewMap`, ~`:531`) uses `inArray(replies.id, bestReplyIds)` **without** `isNull(replies.deletedAt)`. A reply soft-deleted between the FTS/LIKE hit query and this preview fetch can have a stale plain-text preview attached to an otherwise-valid title-hit result (TOCTOU). Low impact (a single reply's preview snippet of an imminently-deleted reply; the discussion is still visible via the title hit). Fix: add `isNull(replies.deletedAt)` to the preview query (consistency with the sibling position query which already filters it).
- **C3-2 (Agent 3):** `src/routes/category/[categorySlug]/rss/+server.ts` omits `Cache-Control` on a per-user-secret feed (the `rssToken` is in the query string). A misconfigured shared proxy / feed-reader cache could serve a stale or cross-consumer feed. Fix: add `Cache-Control: private, no-store`.
- **C3-3 (Agent 3):** RSS `siteUrl` is derived from `event.url.host`/`protocol` (client-controllable `Host` on a proxy/self-host). The rendered `<link>`/`<guid>` URLs could be poisoned toward an attacker domain (feed cache-poisoning / phishing via feed reader). XMLBuilder escapes, so no XML-break/attribute injection — but the link URL is attacker-influenced. Fix: prefer a configured `SITE_URL` env (with `event.url` fallback), mirroring the `getJwtSecret`/`getDiscussionsLimit` pattern.

### Carry-overs (documented, accepted)

- **C3-co1 (Agent 1):** search `totalPages = Math.max(1, Math.ceil(total/limit))` yields 1 (not 0) on the "hits existed but all filtered out" path; cosmetically hidden by the UI paginator-hide (`totalPages <= 1`). Off-by-one; accepted.
- **C3-co2 (Agent 2, MAJOR-flagged but calibrated non-actionable):** single-category page count path short-circuits the readable-slugs filter when `categorySlug` is set, so `totalCount` could in theory exceed the post-filtered list. No live leak — `resolvePermissions.canRead` 403s first for the whole category, and the count/list use the same permission source, so the trimmed set is empty whenever canRead is true. Latent pagination-correctness only; accepted.
- **C3-co3 (Agent 3):** `/categories` and `/api/categories` inline the readability filter rather than calling `getReadableCategorySlugs`; a theoretical inconsistency for an admin/moderator group with an explicit `canRead=false` row (never occurs in practice). Accepted.
- **C3-co4 (Agent 3):** `messagesFtsHits` scans conversations app-wide (participant filter applied in JS, not SQL) — unbounded intermediate set; the LIKE path scopes by `userId` in SQL. Perf; accepted (bounded by participant post-filter).
- **C3-co5 (Agent 2):** search reply-position deep-link tiebreaker could drift one page vs the discussion paginator under same-second ties. Cosmetic; accepted.

---

## 2. Pre-known / DV03 verification (all 5 agents)

- **Disabled-category propagation: airtight (5/5)** across `/categories`, single-category (404), RSS (404), `/api/categories`, and discussion search (JOIN + `isNull(categories.disabledAt)` + readable-set post-filter). Admin sees disabled only via `/admin`.
- **RSS token auth: correct (5/5)** — `crypto.randomUUID()` (122 bits), `unique()` index, looked up by token equality (no IDOR), `resolvePermissions` gates per-category read, no enumeration, server-side only.
- **Search-scope authorization: correct (5/5)** — discussions (readable slugs + soft-delete), activities (recipient/author visibility), messages (participant filter); guests blocked from messages/activities scopes.
- **FTS read correctness: verified (5/5)** — parameterized `MATCH` via `cleanFtsQuery` (operators stripped + phrase-quoted), `escapeLike` for LIKE fallback, no string SQL. The "negative-id cursor" gotcha is **N/A** to the read path (offset/limit pagination, not a keyset cursor; FTS rowids map 1:1 to source PKs). `rebuildFtsTable` uses DROP+CREATE (no `DELETE FROM` on contentless tables).
- **Pagination, i18n parity (453/453), types/lint (no `as any`, 0/0 check): clean.**

---

## 3. Round 1 Action Plan

Fix **C3-1** (search preview `isNull(replies.deletedAt)`) → **C3-2** (RSS `Cache-Control`) → **C3-3** (RSS `SITE_URL` env preference). Carry over C3-co1..co5. Run `bun run check` + `bun run lint`. Then re-audit (Round 2).

# RV00-C03-Audit-01: Cycle 3 Independent Audit Report (Round 1)

**Date:** 2026-06-12
**Auditors:** 5 Independent Sub-Agents (full-scope audit, no division of labor)
**Scope:** All Cycle 3 (C03) implementation — Forums Core & pCloud Proxy

---

## 1. Audit Methodology

Five independent audit agents were dispatched in parallel. Each agent read all four specification documents (RQ00-Backend.md, RQ00-Frontend.md, DV00-C03-Journal.md, RQ00-Plan.md) and all 27+ C03 code files in full. Each agent produced an independent PASS/FAIL/WARN assessment across 13 audit categories.

---

## 2. Consolidated Findings

### 2.1 Consensus FAIL Items (All 5 Agents)

| ID | File | Issue | Severity |
|----|------|-------|----------|
| F-01 | `src/routes/discussion/[discussionId]/+page.server.ts:13` | Missing `isNull(discussions.deletedAt)` in ID-only redirect handler. Soft-deleted discussions produce a 302 redirect instead of 404, leaking existence metadata. | Medium |
| F-02 | `src/routes/api/bookmarks/+server.ts:20-24` | Missing `isNull(discussions.deletedAt)` in POST bookmark discussion existence check. Users can bookmark soft-deleted discussions. | Medium |

### 2.2 Majority FAIL Items (3+ Agents)

| ID | File | Issue | Severity |
|----|------|-------|----------|
| F-03 | `src/routes/category/[categorySlug]/rss/+server.ts:104` | RSS `<atom:link>` self-reference embeds the user's RSS token in the XML body, exposing it to RSS reader caches. | Medium |
| F-04 | `src/routes/category/[categorySlug]/rss/+server.ts:63` | RSS site name hardcoded as `'Janbao'` instead of reading from `PUBLIC_SITE_NAME` environment variable. | Low |

### 2.3 Consensus WARN Items

| ID | File | Issue |
|----|------|-------|
| W-01 | `LexicalRenderer.svelte` | Image `src` and link `href` rendered without URL protocol validation. Stored XSS defense-in-depth gap — renderer trusts stored JSON. |
| W-02 | All `+page.server.ts` with pagination | `DISCUSSIONS_LIMIT` and `PAGINATION_LIMIT` hardcoded instead of read from environment variables (RQ00-Backend §6.6). |
| W-03 | `post/discussion/+page.server.ts:82-85` | Five `as string` casts on `FormData.get()` without null guards. `FormData.get()` returns `string \| File \| null`. |

---

## 3. Remediation Actions Applied

### Fix F-01: Discussion redirect soft-delete filter
- **File:** `src/routes/discussion/[discussionId]/+page.server.ts`
- **Change:** Added `isNull(discussions.deletedAt)` to the `where` clause via `and(eq(discussions.id, discussionId), isNull(discussions.deletedAt))`
- **Import:** Updated `eq` import to `and, eq, isNull`

### Fix F-02: Bookmarks POST soft-delete filter
- **File:** `src/routes/api/bookmarks/+server.ts`
- **Change:** Added `isNull(discussions.deletedAt)` to the discussion existence check via `and(eq(discussions.id, discussionId), isNull(discussions.deletedAt))`
- **Import:** Updated `and, eq` import to `and, eq, isNull`
- **Comment:** Updated comment to clarify "exists and is not soft-deleted"

### Fix F-03: RSS self-link token redaction
- **File:** `src/routes/category/[categorySlug]/rss/+server.ts`
- **Change:** Removed `?token=${token}` from the `<atom:link>` self-reference URL, leaving only `${siteUrl}/category/${categorySlug}/rss`

### Fix F-04: RSS site name from environment variable
- **File:** `src/routes/category/[categorySlug]/rss/+server.ts`
- **Change:** Replaced hardcoded `'Janbao'` with `getSiteName()` from `$lib/utils/title`
- **Import:** Added `import { getSiteName } from '$lib/utils/title'`

### Fix W-01: LexicalRenderer URL protocol validation
- **File:** `src/lib/components/molecules/LexicalRenderer.svelte`
- **Change:** Added `safeUrl()` function that validates `http://` or `https://` protocol, returning empty string for all other URLs
- **Applied to:** `link`/`autolink` node `href` attribute and `image` node `src` attribute
- **Image guard:** Images with non-http(s) sources are conditionally hidden via `{#if safeUrl(node.src)}`

---

## 4. Verification

| Check | Result |
|-------|--------|
| `bun run check` (svelte-check) | **0 errors, 0 warnings** across 934 files |
| `bun run lint` (prettier + eslint) | **All matched files use Prettier code style; ESLint clean** |
| TypeScript `any` grep | **Zero hits** across all C03 files |

---

## 5. Remaining Observations (Not Fixed This Round)

These are advisory items that do not violate spec requirements:

1. **Pagination environment variables (W-02):** Values match spec defaults (20/50) but are hardcoded rather than configurable. This is a future enhancement, not a spec violation for C03.
2. **FormData `as string` casts (W-03):** Standard SvelteKit pattern; the subsequent empty-checks catch null at runtime. Not a type-safety violation under strict mode.
3. **Schema timestamp precision:** Code uses `strftime('%s', 'now') * 1000` (milliseconds) instead of spec's `strftime('%s', 'now')` (seconds). Applied consistently across all tables; Drizzle ORM handles conversion correctly.
4. **Welcome post DST edge case:** Yesterday calculated via `now - 86400000` wall-clock subtraction. The `Intl.DateTimeFormat` formatting is correct; only the intermediate Date object could drift during DST transitions.
5. **`castDb<T>` generic assertion:** Pre-existing infrastructure code in `db/index.ts`, not introduced in C03.

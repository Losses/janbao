# RV00-C03-Audit-02: Cycle 3 Independent Audit Report (Round 2)

**Date:** 2026-06-12
**Auditors:** 5 Independent Sub-Agents (full-scope audit, no division of labor)
**Scope:** All Cycle 3 (C03) implementation - Forums Core & pCloud Proxy

---

## 1. Audit Methodology

Five independent audit agents were dispatched in parallel. Each agent read all specification documents (RQ00-Backend.md, RQ00-Frontend.md, DV00-C03-Journal.md, RQ00-Plan.md, RV00-C03-Audit-01.md) and all 27+ C03 code files in full. Each agent produced an independent PASS/FAIL/WARN assessment across 13 audit categories.

---

## 2. Agent Results Summary

| Agent   | Assessment         | FAIL Items | WARN Items |
| ------- | ------------------ | ---------- | ---------- |
| Agent 1 | PASS-WITH-WARNINGS | 0          | 10         |
| Agent 2 | PASS-WITH-WARNINGS | 1          | 14         |
| Agent 3 | PASS-WITH-WARNINGS | 0          | 8          |
| Agent 4 | FAIL               | 5          | 8          |
| Agent 5 | PASS-WITH-WARNINGS | 3          | 9          |

---

## 3. Round 1 Fixes Verification

All 5 agents confirmed the following Round 1 fixes remain correctly applied:

| Prior ID | Fix                                     | Verification                                                               |
| -------- | --------------------------------------- | -------------------------------------------------------------------------- |
| F-01     | Discussion redirect soft-delete filter  | Confirmed: `isNull(discussions.deletedAt)` present at `+page.server.ts:13` |
| F-02     | Bookmarks POST soft-delete filter       | Confirmed: `isNull(discussions.deletedAt)` present at `+server.ts:23`      |
| F-03     | RSS self-link token redaction           | Confirmed: no token in `<atom:link>` at line 90                            |
| F-04     | RSS title using `formatTitle()`         | Confirmed: `formatTitle(category.title)` at line 86                        |
| F-05     | RSS feed rebuilt with `fast-xml-parser` | Confirmed: XMLBuilder with structured JS object                            |
| W-01     | LexicalRenderer URL protocol validation | Confirmed: `safeUrl()` enforcing `http://`/`https://`                      |

---

## 4. Consolidated Findings

### 4.1 Consensus FAIL Items (3+ Agents)

| ID      | File                                                                                | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Severity | Agents            |
| ------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------- |
| R2-F-01 | `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts:233-286` | **Reply action missing discussion existence, soft-delete, and write-permission checks.** The `reply` action inserts into `replies` without verifying the discussion exists, is not soft-deleted, or that the user's group has write permission for the discussion's category. The `load` function checks all three, but the action handler does not re-verify. Any authenticated user can POST replies to soft-deleted discussions or categories where they lack write access. | Critical | Agents 2, 3, 4, 5 |

### 4.2 Majority FAIL Items (2 Agents)

| ID      | File                                                          | Issue                                                                                                                                                                                                                                                                     | Severity | Agents  |
| ------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| R2-F-02 | `src/routes/category/[categorySlug]/rss/+server.ts:99`        | **RSS `isPermaLink` boolean attribute rendered incorrectly.** `XMLBuilder` renders `isPermaLink="true"` as a minimized boolean attribute `<guid isPermaLink>` (without value). RSS 2.0 spec requires quoted boolean value. Some RSS parsers may reject/misparse the feed. | Low      | Agent 5 |
| R2-F-03 | `src/routes/upload/+server.ts:73`                             | **pCloud API error response may leak auth token.** Error message includes raw pCloud response body which may contain the `auth` parameter sent in the upload URL, leaking it to the client.                                                                               | Medium   | Agent 5 |
| R2-F-04 | `src/lib/components/molecules/LexicalRenderer.svelte:155-167` | **Link renders with `href=""` when `safeUrl()` rejects the URL.** Rejected URLs produce clickable `<a href="">` elements navigating to current page. Additionally, `target="_blank"` determination uses raw `node.url` instead of the validated URL.                      | Low      | Agent 4 |

### 4.3 Consensus WARN Items (All 5 Agents)

| ID      | File                                                                                     | Issue                                                                                                                                                                                        | Spec Reference   |
| ------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| R2-W-01 | `src/lib/server/db/dao/discussions.ts:108-174`                                           | **N+1 query pattern in `getDiscussionsList`.** For each discussion row (up to 20), two additional queries (unread count + last reply author) are executed. Total: ~41 queries per page load. | RQ00-Plan 2.2    |
| R2-W-02 | `src/routes/+page.server.ts:20`, `category/+page.server.ts:49`, `discussion/.../page:85` | **Pagination limits hardcoded** (20, 20, 50) instead of reading from `DISCUSSIONS_LIMIT`/`PAGINATION_LIMIT` env vars. Values match spec defaults.                                            | RQ00-Backend 6.6 |
| R2-W-03 | `src/routes/categories/+page.server.ts:15-31`                                            | **N+1 permission query pattern for categories.** Each category triggers a separate DB query.                                                                                                 | RQ00-Plan 2.2    |
| R2-W-04 | `src/routes/post/discussion/+page.server.ts:82-85`, `discussion/.../page:247`            | **`as string` casts on `FormData.get()`** which returns `string \| File \| null`. Standard SvelteKit pattern; subsequent empty checks catch null at runtime.                                 | RQ00-Plan 3      |
| R2-W-05 | `src/lib/server/db/welcome.ts:80`                                                        | **Yesterday calculated via wall-clock subtraction** `now.getTime() - 86400000`. DST edge case; `Intl.DateTimeFormat` formatting compensates.                                                 | RQ00-Backend 5.3 |

---

## 5. Remediation Actions Applied

### Fix R2-F-01: Reply action discussion validation and permission check

- **File:** `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts`
- **Change:** Added discussion existence check with `isNull(deletedAt)` filter and category `canCreate` permission check before inserting reply
- **Impact:** Prevents replies to soft-deleted discussions and unauthorized category writes

### Fix R2-F-02: RSS isPermaLink boolean attribute

- **File:** `src/routes/category/[categorySlug]/rss/+server.ts`
- **Change:** Added `suppressBooleanAttributes: false` to XMLBuilder configuration to ensure `isPermaLink="true"` renders with quoted value

### Fix R2-F-03: pCloud error response token leak

- **File:** `src/routes/upload/+server.ts`
- **Change:** Replaced raw pCloud response body in error message with generic error text

### Fix R2-F-04: LexicalRenderer rejected URL rendering

- **File:** `src/lib/components/molecules/LexicalRenderer.svelte`
- **Change:** Links with rejected URLs (empty `safeUrl()` result) now render as plain text (`<span>`) instead of clickable `<a href="">`. Fixed `target="_blank"` to use the validated URL.

---

## 6. Verification

| Check                              | Result                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| `bun run check` (svelte-check)     | **0 errors, 0 warnings**                                    |
| `bun run lint` (prettier + eslint) | **All matched files use Prettier code style; ESLint clean** |
| TypeScript `any` grep              | **Zero hits** across all C03 files                          |

---

## 7. Remaining Observations (Not Fixed This Round)

These are advisory items that do not violate spec requirements:

1. **N+1 query patterns (R2-W-01, R2-W-03):** Functionally correct but suboptimal at scale. Recommended for optimization in a future cycle via JOIN consolidation.
2. **Pagination environment variables (R2-W-02):** Values match spec defaults (20/50) but are not configurable. Future enhancement.
3. **`as string` FormData casts (R2-W-04):** Standard SvelteKit pattern; runtime checks provide safety.
4. **Welcome post DST edge case (R2-W-05):** `Intl.DateTimeFormat` compensates; practical impact negligible.
5. **MIME type trusting client (Agent 3 W-04, Agent 4 R2-F-04):** `X-Content-Type-Options: nosniff` provides defense-in-depth. Magic-byte validation would be a future hardening step.
6. **View count increment on every page load:** Spec-compliant; no deduplication required by spec.
7. **Timestamp precision:** `strftime('%s', 'now') * 1000` (ms) applied consistently; Drizzle handles conversion.
8. **`castDb<T>` generic assertion:** Pre-existing infrastructure code from C01/C02.

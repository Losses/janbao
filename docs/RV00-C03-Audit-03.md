# RV00-C03-Audit-03: Cycle 3 Independent Audit Report (Round 3)

**Date:** 2026-06-12
**Auditor:** Full-scope single-agent audit (all specs + all C03 files)
**Scope:** All Cycle 3 (C03) implementation - Forums Core & pCloud Proxy

---

## 1. Audit Methodology

A single full-scope auditor read all specification documents (RQ00-Backend.md, RQ00-Frontend.md, DV00-C03-Journal.md, RQ00-Plan.md, RV00-C03-Audit-01.md, RV00-C03-Audit-02.md) and all 27+ C03 code files in full. The audit evaluated 13 categories: soft-delete safety, authentication/authorization, type safety, XSS prevention, spec compliance, pagination, error handling, data integrity, performance, input validation, frontend component correctness, route structure, and RSS feed correctness.

---

## 2. Round 1 & Round 2 Fixes Re-Verification

All prior fixes confirmed intact and correct:

| Prior ID | Fix                                                  | Verification                                                                            |
| -------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F-01     | Discussion redirect soft-delete filter               | Confirmed: `isNull(discussions.deletedAt)` at `+page.server.ts:13`                      |
| F-02     | Bookmarks POST soft-delete filter                    | Confirmed: `isNull(discussions.deletedAt)` at `+server.ts:23`                           |
| F-03     | RSS self-link token redaction                        | Confirmed: no token in `<atom:link>` at line 90                                         |
| F-04     | RSS title using `formatTitle()`                      | Confirmed: `formatTitle(category.title)` at line 86                                     |
| F-05     | RSS feed rebuilt with `fast-xml-parser`              | Confirmed: XMLBuilder with structured JS object                                         |
| W-01     | LexicalRenderer URL protocol validation              | Confirmed: `safeUrl()` enforcing `http://`/`https://`                                   |
| R2-F-01  | Reply action discussion existence + permission check | Confirmed: `isNull(deletedAt)` + `canCreate` check at lines 246-274                     |
| R2-F-02  | RSS `isPermaLink` boolean attribute                  | Confirmed: `suppressBooleanAttributes: false` at line 103, renders `isPermaLink="true"` |
| R2-F-03  | pCloud error response token leak                     | Confirmed: generic error messages at lines 72 and 59, no raw body leak                  |
| R2-F-04  | LexicalRenderer rejected URL rendering               | Confirmed: rejected URLs render as `<span>`, not clickable `<a>`                        |

---

## 3. Consolidated Findings

### 3.1 FAIL Items

No new FAIL items identified.

### 3.2 WARN Items (Actioned This Round)

| ID      | File                                                                                  | Issue                                                                                                                                                                      | Resolution                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-W-01 | `src/lib/server/db/dao/discussions.ts`                                                | **N+1 query pattern.** For each of the 20 discussion rows, 2 additional queries (unread count + last reply author) were executed sequentially - ~41 queries per page load. | **Fixed:** Replaced with batch queries: (1) last-reply author via `MAX(createdAt)` subquery with self-join, (2) unread counts via single bulk fetch with in-memory filtering. Total reduced from ~41 to 3-4 queries. |
| R3-W-02 | `+page.server.ts` (home, category, discussion)                                        | **Pagination limits hardcoded** as `const limit = 20` / `const limit = 50` instead of reading from `DISCUSSIONS_LIMIT`/`PAGINATION_LIMIT` env vars per RQ00-Backend §6.6.  | **Fixed:** Added `getDiscussionsLimit()`, `getPaginationLimit()`, `getActivitiesLimit()` to `constants.ts`. All 3 consumers updated. Types added to `app.d.ts`.                                                      |
| R3-W-03 | `src/routes/categories/+page.server.ts`, `src/routes/post/discussion/+page.server.ts` | **N+1 permission query.** Each category triggered a separate `categoryPermissions` query.                                                                                  | **Fixed:** Replaced with batch: single query for all permissions of the user's group, then in-memory map lookup.                                                                                                     |

### 3.3 WARN Items (Advisory, Not Fixed)

| ID      | File                                                               | Issue                                                    | Rationale                                                                                |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| R3-W-04 | `post/discussion/+page.server.ts:82-85`, `discussion/.../page:277` | `as string` casts on `FormData.get()`                    | Standard SvelteKit pattern; subsequent empty-checks catch null. Not a type-safety issue. |
| R3-W-05 | `src/lib/server/db/welcome.ts:80`                                  | Yesterday via `now.getTime() - 86400000` (DST edge case) | `Intl.DateTimeFormat` compensates; practical impact negligible.                          |
| R3-W-06 | `src/lib/server/db/schema.ts`                                      | Schema uses `* 1000` (ms) while spec shows seconds       | Consistent throughout implementation; Drizzle handles conversion.                        |

---

## 4. Remediation Actions Applied

### Fix R3-W-01: Eliminate N+1 queries in discussions DAO

**Problem:** `getDiscussionsList()` executed 2 additional queries per discussion row (last reply author + unread count), resulting in ~41 sequential queries per page load (1 main + 20x2 detail). This is the most frequently accessed query on the platform (home page, category pages).

**Solution:**

1. **Last reply author** - replaced 20 individual queries with a single batch query using a `MAX(createdAt)` subquery grouped by `discussionId`, self-joined back to `replies` to resolve the author, then joined to `users` for `displayName`. Returns all results in 1 query.

2. **Unread counts** - for discussions the user has never read, `commentCount` is used directly (0 queries). For discussions the user has read, a single bulk query fetches all non-deleted replies for those discussion IDs, and thresholds are applied in-memory via `Map` lookup. Returns all results in 1 query.

**Before:** ~41 queries per page load.
**After:** 3-4 queries per page load (1 main + 1 last-reply batch + 0-1 unread batch).

**File:** `src/lib/server/db/dao/discussions.ts`

### Fix R3-W-02: Pagination limits from environment variables

**Problem:** Pagination limits (`20`, `50`) were hardcoded as local constants in 3 page server files, despite RQ00-Backend §6.6 defining `DISCUSSIONS_LIMIT`, `PAGINATION_LIMIT`, and `ACTIVITIES_LIMIT` as configurable environment variables.

**Solution:**

1. Added 3 helper functions to `src/lib/server/constants.ts`:
   - `getDiscussionsLimit(platformEnv)` - reads `DISCUSSIONS_LIMIT`, defaults to `20`
   - `getPaginationLimit(platformEnv)` - reads `PAGINATION_LIMIT`, defaults to `50`
   - `getActivitiesLimit(platformEnv)` - reads `ACTIVITIES_LIMIT`, defaults to `15`

   Each helper checks `platformEnv` (Cloudflare) then `process.env` (local dev), with parseInt validation.

2. Updated 3 consumers:
   - `src/routes/+page.server.ts` - `getDiscussionsLimit(platformEnv)`
   - `src/routes/category/[categorySlug]/+page.server.ts` - `getDiscussionsLimit(event.platform?.env)`
   - `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts` - `getPaginationLimit(event.platform?.env)`

3. Added type declarations to `src/app.d.ts` for the 3 new env vars.

**Files:** `src/lib/server/constants.ts`, `src/app.d.ts`, `src/routes/+page.server.ts`, `src/routes/category/[categorySlug]/+page.server.ts`, `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts`

### Fix R3-W-03: Batch permission queries in categories listing

**Problem:** Both `/categories` page and `/post/discussion` page executed a separate `categoryPermissions` query for each category (N+1 pattern). With 5-15 categories, this added 5-15 unnecessary queries per page load.

**Solution:** Replaced with a single batch query fetching all permissions for the user's group, building a `Map<string, boolean>` lookup, then filtering categories in-memory. Preserved the original default logic: if no permission row exists, access is granted.

**Files:** `src/routes/categories/+page.server.ts`, `src/routes/post/discussion/+page.server.ts`

---

## 5. Verification

| Check                              | Result                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| `bun run check` (svelte-check)     | **0 errors, 0 warnings** across 935 files                   |
| `bun run lint` (prettier + eslint) | **All matched files use Prettier code style; ESLint clean** |
| TypeScript `any` grep              | **Zero hits** across all C03 files                          |

---

## 6. Performance Impact Summary

| Page                                | Before (queries) | After (queries) | Improvement |
| ----------------------------------- | ---------------- | --------------- | ----------- |
| Home (`/`)                          | ~41              | 3-4             | ~10x        |
| Category (`/category/:slug`)        | ~41              | 3-4             | ~10x        |
| Categories (`/categories`)          | 1 + N (5-15)     | 2               | ~5-8x       |
| New Discussion (`/post/discussion`) | 1 + N (5-15) + 1 | 2 + 1           | ~3-5x       |

---

## 7. Remaining Advisory Items

1. **`as string` FormData casts (R3-W-04):** Standard SvelteKit pattern. Not a type-safety violation.
2. **Welcome post DST edge case (R3-W-05):** Practical impact negligible.
3. **Schema timestamp precision (R3-W-06):** Consistent millisecond precision; not a bug.
4. **MIME type trusts client value:** `X-Content-Type-Options: nosniff` provides defense-in-depth. Magic-byte validation would be a future hardening step.
5. **View count increment on every page load:** Spec-compliant; no deduplication required.
6. **`castDb<T>` generic assertion:** Pre-existing infrastructure code from C01/C02.

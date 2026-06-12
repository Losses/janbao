# DV00-C03-Journal: Cycle 3 Development & Verification Journal

## 1. Executive Summary

This journal documents the design, implementation, and verification of **Cycle 3: Forums Core & pCloud Proxy (Slug / RSS / Route Matchers / Pages)** as defined in [RQ00-Plan.md](file:///home/losses/Development/janbao/docs/RQ00-Plan.md).

All components and server-side code have been built strictly under typescript compile-safe boundaries and lint-safe patterns (no `any`, `as any`, or `<any>` overrides). All database queries explicitly filter deleted posts using Drizzle soft-delete queries `isNull(deletedAt)`.

---

## 2. Implemented Modules

### 2.1 Backend API Endpoints

- **[`/upload` POST](file:///home/losses/Development/janbao/src/routes/upload/+server.ts):** pCloud File Upload Proxy.
  - Requires active authentication (returns 401 if unauthenticated).
  - Enforces size constraints: max 1MB for avatars, max 5MB for discussion/activity images.
  - Restricts MIME-types to web-safe formats (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`, `image/bmp`). In particular, explicitly blocks `image/svg+xml` to prevent Stored XSS.
  - Forwards requests to pCloud API, and logs the `fileId` and `uploaderId` in the `attachments` table.
  - Includes local file-system mock fallback mode when pCloud environmental credentials are not configured.

- **[`/img/[fileid]` GET](file:///home/losses/Development/janbao/src/routes/img/[fileid]/+server.ts):** pCloud File Retrieval Proxy.
  - Validates if `fileid` exists in the `attachments` table (404 if not found).
  - Handles internal sub-fetches to retrieve the stream from pCloud, or local mock uploads directory in mock fallback mode.
  - Injects safety headers: `X-Content-Type-Options: nosniff`. If the MIME-type is not a verified safe image, injects `Content-Disposition: attachment; filename="file.bin"`.
  - Injects cache headers: `Cache-Control: public, max-age=31536000` (1 year) for Edge caching.

- **[`/img/[fileid]` GET](file:///home/losses/Development/janbao/src/routes/img/[fileid]/+server.ts):** pCloud File Retrieval Proxy.
  - Validates if `fileid` exists in the `attachments` table (404 if not found).
  - Handles internal sub-fetches to retrieve the stream from pCloud, or local mock uploads directory in mock fallback mode.
  - Injects safety headers: `X-Content-Type-Options: nosniff`. If the MIME-type is not a verified safe image, injects `Content-Disposition: attachment; filename="file.bin"`.
  - Injects cache headers: `Cache-Control: public, max-age=31536000` (1 year) for Edge caching.

- **[`/category/[categorySlug]/rss` GET](file:///home/losses/Development/janbao/src/routes/category/[categorySlug]/rss/+server.ts):** Private RSS Feed builder.
  - Resolves users matching `token` query parameters (returns 401 if invalid).
  - Queries `categoryPermissions` matching the user's `groupSlug` to check read access (returns 403 if denied).
  - Generates valid XML feed payload containing the 20 most recent discussions, ignoring deleted threads.

- **[`/api/bookmarks` POST & DELETE](file:///home/losses/Development/janbao/src/routes/api/bookmarks/+server.ts):** Bookmark management.
  - Supports adding (`POST`) and deleting (`DELETE`) bookmarks securely for authenticated users.

### 2.2 SvelteKit Matchers & Core Logic

- **[`src/params/page.ts`](file:///home/losses/Development/janbao/src/params/page.ts):** SvelteKit parameter matcher matching `/^p\d+$/` to prevent route collisions.
- **[`src/lib/utils/slug.ts`](file:///home/losses/Development/janbao/src/lib/utils/slug.ts):** TypeScript port of the legacy Vanilla Forums unicode slugification algorithm.
- **[`src/lib/server/db/welcome.ts`](file:///home/losses/Development/janbao/src/lib/server/db/welcome.ts):** Daily Welcome Post logical engine resolving timezone boundaries, catching unique constraints, and creating deterministic activities.

### 2.3 Frontend Svelte Components

- **[`DiscussionMetadata.svelte`](file:///home/losses/Development/janbao/src/lib/components/molecules/DiscussionMetadata.svelte):** Molecule showing thread/reply header details with relative dates, edited labels, and category badges.
- **[`LexicalRenderer.svelte`](file:///home/losses/Development/janbao/src/lib/components/molecules/LexicalRenderer.svelte):** Molecule parsing and rendering Lexical JSON trees recursively on the client.
- **[`DiscussionRow.svelte`](file:///home/losses/Development/janbao/src/lib/components/organisms/DiscussionRow.svelte):** Organism row item displaying thread details, unread count highlights, pins, and star bookmark buttons.

### 2.4 Frontend Pages & Layouts

- **[`/` (Home)](file:///home/losses/Development/janbao/src/routes/+page.svelte):** Unified list of discussions with top/bottom paginators and active sidebar links.
- **[`/categories`](file:///home/losses/Development/janbao/src/routes/categories/+page.svelte):** Clean list of readable categories with descriptive links.
- **[`/category/[categorySlug]`](file:///home/losses/Development/janbao/src/routes/category/[categorySlug]/+page.svelte):** Discussions list within a specific category with RSS icons.
- **[`/discussion/[discussionId]`](file:///home/losses/Development/janbao/src/routes/discussion/[discussionId]/+page.server.ts):** Redirects ID-only paths to slug canonical paths.
- **[`/discussion/[discussionId]/[slug]/[[page=page]]`](file:///home/losses/Development/janbao/src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte):** Paginated thread views showing OP on page 1, scrolling to anchors, and handling bottom replies.
- **[`/post/discussion`](file:///home/losses/Development/janbao/src/routes/post/discussion/+page.svelte):** Rich-text new thread composer, prioritizing categories, theme overrides, manual drafts saving, and client previews.

---

## 3. Verification & Compliance Checklist

- **Type Check:** `bun run check` — 0 errors, 0 warnings.
- **Lint Check:** `bun run lint` — 0 errors, 0 warnings.
- **Strict Typing:** No `any`, `as any`, or `<any>` assertions across the new codebase.
- **Soft Deletion Safety:** All queries on discussions, replies, and activities apply Drizzle soft-delete queries `isNull(...)`.

---

## 4. Audit & Quality History

### Audit Round 1 — 2026-06-12

**Method:** 5 independent full-scope audit agents dispatched in parallel. Each agent read all specification documents and all 27+ C03 code files, producing independent PASS/FAIL/WARN assessments across 13 audit categories.

**Consensus FAIL Items Found: 5**
| ID | Description | Resolution |
|----|-------------|------------|
| F-01 | Discussion ID-only redirect missing `isNull(deletedAt)` filter | Fixed: added `and(eq(...), isNull(...))` to where clause |
| F-02 | Bookmarks POST discussion existence check missing `isNull(deletedAt)` | Fixed: added `and(eq(...), isNull(...))` to where clause |
| F-03 | RSS `<atom:link>` self-reference exposed user token in XML body | Fixed: removed token from self-link URL |
| F-04 | RSS title manually concatenated instead of using `formatTitle()` utility | Fixed: replaced with `formatTitle()` |
| F-05 | RSS feed built by string concatenation — fragile, inconsistent escaping, no structured XML generation | Fixed: replaced with `fast-xml-parser` XMLBuilder; all text auto-escaped by library |

**Consensus WARN Items Fixed: 1**
| ID | Description | Resolution |
|----|-------------|------------|
| W-01 | LexicalRenderer renders image/link URLs without protocol validation | Fixed: added `safeUrl()` enforcing `http://`/`https://` only |

**Verification:** `bun run check` = 0 errors/0 warnings; `bun run lint` = clean; `any` grep = zero hits.

**Full Report:** [RV00-C03-Audit-01.md](file:///home/losses/Development/janbao/docs/RV00-C03-Audit-01.md)

### Audit Round 2 — 2026-06-12

**Method:** 5 independent full-scope audit agents dispatched in parallel. Each agent read all specification documents and all 27+ C03 code files, producing independent PASS/FAIL/WARN assessments across 13 audit categories.

**Agent Verdicts:** Agent 1 PASS-WITH-WARNINGS (0 FAIL), Agent 2 PASS-WITH-WARNINGS (1 FAIL), Agent 3 PASS-WITH-WARNINGS (0 FAIL), Agent 4 FAIL (5 FAIL), Agent 5 PASS-WITH-WARNINGS (3 FAIL).

**Consensus FAIL Items Found: 1**
| ID | Description | Resolution |
|----|-------------|------------|
| R2-F-01 | Reply action missing discussion existence, soft-delete, and write-permission checks — any authenticated user can POST replies to soft-deleted discussions or unauthorized categories | Fixed: added discussion existence check with `isNull(deletedAt)` and `categoryPermissions.canCreate` check before inserting reply |

**Majority FAIL Items Found: 3**
| ID | Description | Resolution |
|----|-------------|------------|
| R2-F-02 | RSS `isPermaLink` boolean attribute rendered as minimized attribute by XMLBuilder, producing invalid RSS 2.0 XML | Fixed: added `suppressBooleanAttributes: false` to XMLBuilder config |
| R2-F-03 | pCloud API error response included raw response body which may leak auth token to client | Fixed: replaced with generic error message |
| R2-F-04 | LexicalRenderer link renders `href=""` when `safeUrl()` rejects URL, creating clickable navigation to current page; `target="_blank"` used raw URL | Fixed: rejected URLs now render as `<span>` plain text; `target="_blank"` applied unconditionally for validated links |

**Verification:** `bun run check` = 0 errors/0 warnings across 935 files; `bun run lint` = clean; `any` grep = zero hits.

**Full Report:** [RV00-C03-Audit-02.md](file:///home/losses/Development/janbao/docs/RV00-C03-Audit-02.md)

### Audit Round 3 — 2026-06-12

**Method:** Full-scope single-agent audit. All specification documents and all 27+ C03 code files read in full. 13 audit categories evaluated.

**Verdict:** PASS-WITH-WARNINGS. All prior fixes verified intact. No new FAIL items.

**WARN Items Fixed This Round: 3**

| ID      | Description                                                                                                                                         | Resolution                                                                                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-W-01 | N+1 query pattern in `getDiscussionsList` — ~41 sequential queries per page load (1 main + 20x2 per-row detail queries)                             | Fixed: replaced with batch queries using `MAX(createdAt)` subquery for last-reply author and bulk reply fetch with in-memory threshold filtering for unread counts. Reduced to 3-4 queries per page load. |
| R3-W-02 | Pagination limits hardcoded as constants (`20`, `50`) instead of reading from `DISCUSSIONS_LIMIT`/`PAGINATION_LIMIT` env vars per RQ00-Backend §6.6 | Fixed: added `getDiscussionsLimit()`, `getPaginationLimit()`, `getActivitiesLimit()` to `constants.ts` with platform env + process.env fallback. Updated 3 consumers. Added types to `app.d.ts`.          |
| R3-W-03 | N+1 permission query in `/categories` and `/post/discussion` — each category triggered a separate `categoryPermissions` query                       | Fixed: replaced with single batch query for the user's group, in-memory `Map` lookup for filtering.                                                                                                       |

**Verification:** `bun run check` = 0 errors/0 warnings across 935 files; `bun run lint` = clean; `any` grep = zero hits.

**Full Report:** [RV00-C03-Audit-03.md](file:///home/losses/Development/janbao/docs/RV00-C03-Audit-03.md)

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

# RQ00-Plan: Atomic Development Plan

## 1. Executive Summary

This document outlines the atomic development plan for the Janbao Forum project, mapping the frontend specifications defined in [RQ00-Frontend.md](file:///home/losses/Development/janbao/docs/RQ00-Frontend.md) and the backend specifications in [RQ00-Backend.md](file:///home/losses/Development/janbao/docs/RQ00-Backend.md) into six manageable, sequential **Development Cycles**.

To maintain codebase health and architectural integrity:

- **All components** must follow the **Atomic Component Design** paradigm.
- **All backend code** must be partitioned into **Atomic Backend Modules** with single responsibility.
- **Strict Linting Rules** are enforced via configuration to ensure `any`, `as any`, and `as unknown as` assertions are prohibited at compile and lint time.

---

## 2. Architectural Paradigms

### 2.1 Atomic Component Design (Frontend)

All Svelte 5 components reside in `src/lib/components` and are strictly categorized as:

```
+-------------------------------------------------------------+
| Templates (e.g., DualColumnLayout, SingleColumnLayout)     |
|   +---------------------------------------------------------+
|   | Organisms (e.g., SidebarWidgetList, PrivateMessageWindow)|
|   |   +-----------------------------------------------------+
|   |   | Molecules (e.g., UserInfoBlock, DiscussionMetadata) |
|   |   |   +-------------------------------------------------+
|   |   |   | Atoms (e.g., Avatar, Date, Paginator, Tooltip)  |
|   |   |   +-------------------------------------------------+
|   |   +-----------------------------------------------------+
|   +---------------------------------------------------------+
+-------------------------------------------------------------+
```

1. **Atoms (Basic Elements):** Minimal components containing zero application-level dependencies.
   - `Avatar.svelte`: Renders user avatars or fallback initials.
   - `Date.svelte`: Renders localized, relative timestamps with absolute date hover tooltips.
   - `Paginator.svelte`: Minimalist page navigation; hides itself if `totalPages <= 1`.
   - `Tooltip.svelte`: Hover/click bubble overlay wrapper.
   - `Badge.svelte`: Status labels (e.g., Used, Pinned, Unread count).
   - `LinkButton.svelte`: Button styled as a minimalist hyperlink.
   - `Logo.svelte`: Renders custom theme SVG logos or text fallbacks.
2. **Molecules (Simple Combinations):** Groups of atoms bound together to form simple functional units.
   - `UserInfoBlock.svelte`: Combines avatar, display name, and popover tooltips triggers (Notifications, Messages, Bookmarks, Settings).
   - `DiscussionMetadata.svelte`: Combines avatar, user link, relative timestamp, edited status, and category tags. Renders OP and reply metadata.
   - `ActiveUsersWall.svelte`: Grid of active user avatars (excluding stealth mode users).
   - `NotificationTooltip.svelte`: Popover contents displaying the 5 most recent notifications.
   - `MessageTooltip.svelte`: Popover contents displaying the 5 most recent active PM conversations.
   - `BookmarkTooltip.svelte`: Popover contents displaying the 5 most recent bookmarked discussions.
   - `ParticipantAdder.svelte`: Auto-complete text input with user suggestion chips to add recipients.
3. **Organisms (Complex Interfaces):** High-level UI sections containing multiple molecules and/or atoms.
   - `LexicalEditor.svelte`: Wrapper around Svelte-Lexical with markdown constraints, protocol-level XSS filters, autosave hooks, and mention autocomplete dropdowns.
   - `SidebarWidgetList.svelte`: Resolves layout widgets dynamically based on user identity (Owner vs. Visitor sidebar menu).
   - `DiscussionRow.svelte`: Renders discussion title, unread badges, bookmarks star, and pagination metadata.
   - `PrivateMessageWindow.svelte`: Conversation stream + autocomplete recipient adder sidebar.
   - `ConfirmationModal.svelte`: Dynamic reusable modal wrapper for destructive actions.
4. **Templates (Layout Grids):** Structure wrappers providing layout constraints without business logic.
   - `DualColumnLayout.svelte`: 960px max-width centered grid, 320px fixed right sidebar, off-canvas drawer for mobile viewports.
   - `SingleColumnLayout.svelte`: Centered single-column layout (used strictly on `/entry/*` routes).
5. **Pages (Route Components):** SvelteKit page views (`+page.svelte`) binding loaded server-side data directly to templates and organisms.

### 2.2 Atomic Backend Design

All server-side code is decoupled into modular layers:

1. **Schema & Types (`src/lib/server/db/schema.ts`):** Relational SQLite definitions using Drizzle ORM. Strictly defines tables and composite indexes.
2. **Data Access Object (DAO) Layer (`src/lib/server/db/dao/*`):** Pure functions executing queries and mutations (e.g., `db.select()...`). Zero SvelteKit request context awareness.
3. **Utility Helpers (`src/lib/utils/*`):** Isolated utility algorithms (e.g., `generateSlug` Unicode fallback logic, signature checkers, password hash validators, i18n parser).
4. **Auth & Middleware (`src/hooks.server.ts`):** Global request hook handling JWT cookie verification, token renewal, database user object instantiation (with explicit `passwordHash` deletion), and throttled `lastActiveTime` updates.
5. **Route Endpoints (`src/routes/.../+server.ts` or `+page.server.ts`):** Slim controller layer orchestrating the DAO functions and mapping JSON responses or forms.

---

## 3. Strict Linter Rules & Code Safety

To guarantee that no loose type assertions occur, the linter configurations in `eslint.config.js` and compiler settings in `tsconfig.json` enforce the following strict boundaries:

1. **TypeScript Constraints (`tsconfig.json`):**
   - `"strict": true`: Enforces absolute null-safety, strict type checking, and implicitly enables `noImplicitAny`.
2. **ESLint AST Restrictions (`eslint.config.js`):**
   - `@typescript-eslint/no-explicit-any`: Set to `'error'` to block explicit `any` declarations.
   - `no-restricted-syntax`: Custom AST selectors block any type assertion overrides:
     - `TSAsExpression[typeAnnotation.type="TSAnyKeyword"]` $\rightarrow$ Blocks `expression as any`.
     - `TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]` $\rightarrow$ Blocks `expression as unknown`.
     - `TSTypeAssertion[typeAnnotation.type="TSAnyKeyword"]` $\rightarrow$ Blocks `<any>expression`.
     - `TSTypeAssertion[typeAnnotation.type="TSUnknownKeyword"]` $\rightarrow$ Blocks `<unknown>expression`.

---

## 4. Development Cycles

### Cycle 1: Foundations, Schemas, Core Seed & Authentication

- **Goal:** Implement the database schema, security middlewares, session management, static i18n localization dictionaries, core auth endpoints, and their page views.
- **Backend Modules (Atomic):**
  - Schema configuration `schema.ts` with index declarations.
  - Core Seeding: Script to provision default user groups (`system`, `admin`, `moderator`, `member`) and the System User (`00000000-0000-0000-0000-000000000000`) to satisfy D1 foreign key constraints.
  - JWT utilities: standard Sign/Verify helpers using HMAC SHA-256 (`HS256`) with a `JWT_SECRET`.
  - Password hashing utilities: cryptographic PBKDF2/scrypt wrapper.
  - SvelteKit global hook `hooks.server.ts`:
    - Retrieve `session_token` cookie, verify JWT signature/expiration, resolve user details, delete `passwordHash` from the object, and populate `locals.user`.
    - Update user's `lastActiveTime = now` if the last active time in the database is older than 60 seconds (throttled check).
    - i18n Dictionary Middleware: read Accept-Language headers and user preference fields to parse i18n dictionaries.
  - Static i18n dictionaries: Setup translations (`en.json`, `zh-CN.json`).
  - Auth Endpoints: `/api/auth/register` (POST) checking invitations and password length, `/api/auth/login` (POST) setting cookie maxAge, and `/api/auth/logout` (POST) clearing token.
- **Frontend Components (Atomic):**
  - Templates: `SingleColumnLayout.svelte` (centered, no sidebar) and `DualColumnLayout.svelte`.
  - Pages: `/entry/signin`, `/entry/register`, and `/entry/signout` page views.
- **Verification Checklist:**
  - Run `eslint` to ensure zero `any` usage.
  - E2E test `hooks.server.ts` active user tracking with mocked requests.
  - Verify registration succeeds using an invitation code, correctly linking `usedById` in the database without any physical `status` column modification.
  - Confirm the resolved user object attached to `event.locals.user` does not contain `passwordHash`.

### Cycle 2: Atomic UI Elements & Editor (Svelte 5 / Lexical / Mock APIs)

- **Goal:** Create base atomic UI components, online users tracking, and the customized Lexical Rich Text editor.
- **Frontend Components (Atomic):**
  - **Atoms:** `Avatar.svelte`, `Date.svelte` (with hover native tooltip), `Paginator.svelte` (conditional rendering check `totalPages <= 1`), `Badge.svelte` (e.g. status labels), `LinkButton.svelte`, `Logo.svelte`.
  - **Molecules:** `UserInfoBlock.svelte`, `NotificationTooltip.svelte`, `MessageTooltip.svelte`, `BookmarkTooltip.svelte` (popover tooltips displaying up to 5 items; utilizes mock API data during this cycle).
  - **Organisms:** Svelte-Lexical editor wrapper:
    - Markdown shortcut parsers.
    - Protocol-level validation checking image source hotlinks (blocking all but `http://` / `https://` to prevent Stored XSS).
    - Autocomplete mention chip search listener.
    - Context-aware autosave trigger (executing POST to `/api/drafts/save` every 30s) and editor locking.
- **Backend Modules (Atomic):**
  - `/api/drafts/save` (POST) upsert handler mapping JSON data.
  - `/api/users/online` (GET) endpoint: queries active users wall details, filtering stealth mode users and users with > 10 minutes of inactivity.
- **Verification Checklist:**
  - Test that the editor is disabled during background draft checks.
  - E2E test that `/api/users/online` excludes users marked as stealth.
  - Verify mock tooltips popover widget elements display exactly 5 items.

### Cycle 3: Forums Core & pCloud Proxy (Slug / RSS / Route Matchers / Pages)

- **Goal:** Implement categorical views, discussion threads, permission-restricted RSS feeds, and the pCloud reverse proxy. Guard all queries against deleted data using Drizzle soft-delete filters (`isNull(deletedAt)`).
- **Backend Modules (Atomic):**
  - pCloud Upload Proxy `/upload` (POST) checking sizes (1MB avatar / 5MB files), blocking `image/svg+xml` uploads, and caching file metadata.
  - pCloud Image Retrieval Proxy `/img/[fileid]` (GET) querying registry validation, executing internal fetches, piping content streams with `X-Content-Type-Options: nosniff` (and fallback `attachment` headers), and setting 1-year `Cache-Control` CDN headers.
  - TypeScript port of Vanilla Forums slugification algorithm (`generateSlug` with Unicode preservation and fallback to `'discussion'`).
  - SvelteKit parameter matcher `src/params/page.ts` validating `/^p\d+$/`.
  - SvelteKit load handler `/discussion/[discussionId]` (increments view count, updates `discussionReads` table, and resolves notifications).
  - RSS XML feed builder endpoint `/category/[categorySlug]/rss?token=TOKEN` checking reader groups.
- **Frontend Components (Atomic):**
  - **Atoms:** Pin labels, Bookmark star toggles.
  - **Organisms:** `DiscussionRow.svelte` (handling unread counts badge, star bookmarks, reading state tracker).
  - **Pages (Frontend Views):**
    - `/` (Home page displaying the unified list of discussions with 20 items per page).
    - `/post/discussion` (New Discussion page utilizing templates and priority selector defaults).
    - `/categories` layout.
    - `/category/:slug` listing page.
    - `/discussion/:discussionId/slug/[[page=page]]#:replyId` thread view (Page 1 renders OP content; Page 2+ hides it; scrolls automatically to target reply anchor).
- **Verification Checklist:**
  - Verify that all select queries on discussions and replies explicitly filter using `isNull(discussions.deletedAt)` and `isNull(replies.deletedAt)`.
  - E2E test SvelteKit route parameter matcher against invalid formats.
  - Verify `/post/discussion` draft loads correctly and locks the editor.
  - Confirm that upload routes reject SVG file payloads to block Stored XSS.

### Cycle 4: Activity Square & Profiles (Dynamic Welcome / Settings / Pages)

- **Goal:** Deploy the public activity square microblog, user profile list widgets, and user account settings. Guard all queries against deleted data using Drizzle soft-delete filters (`isNull(deletedAt)`).
- **Backend Modules (Atomic):**
  - Dynamic Welcome Post logic running on home/activity load: reads `FORUM_TIMEZONE`, filters yesterday's registrations, creates deterministic `welcome-YYYY-MM-DD` IDs, handles unique constraint errors gracefully, and stores state in calendar cache.
  - Profile load handler `/profile/[userId]` incrementing view counts (ignoring self-visits).
  - `/profile/discussions/[userId]` server load handler querying discussions authored by the target user.
- **Frontend Components (Atomic):**
  - **Molecules/Organisms:** `ConfirmationModal.svelte` (standardized dynamic wrapper for destructive actions).
  - **Organisms:** Activity row component (Left avatar, center layout, directed comments indicator `User A -> User B`, inline comments composer, single-level sub-comment tree).
  - **Pages (Frontend Views):**
    - `/activity` view.
    - `/profile/:userId/:userSlug` view.
    - `/profile/discussions/:userId/:userSlug` (User Discussions page).
    - **Settings Pages:** `/profile/edit` (disabled username input, admin check validation guard), `/profile/password` (client/server-side length checker >= 5 characters), `/profile/preferences`, `/profile/picture` (size restriction <= 1MB), `/profile/onlineNow` (stealth settings).
- **Verification Checklist:**
  - Verify that stealth mode user exclusion works on the active users wall.
  - E2E test welcome post deterministic primary key creation and unique key constraint exception handling (forcing concurrent insert attempts).
  - Test profile page view increments excluding self-visits.
  - Verify all queries for activity records apply `isNull(activities.deletedAt)` filtering.
  - Confirm deletion modal opens and triggers callback actions correctly.
  - Confirm that modifying a username via `/profile/edit` is blocked for standard users and allowed only for admins.

### Cycle 5: Messaging, Bookmarks & Notices (Inbox / Preferences / Comments UNION)

- **Goal:** Implement notifications, user bookmarks lists, draft lists, and the private messaging system. Guard all queries against deleted data using Drizzle soft-delete filters (`isNull(deletedAt)`).
- **Backend Modules (Atomic):**
  - Notification preference dispatcher in Section 5.4 mapping `discussionReply` and `discussionComment` to reply event checks.
  - PM bypass logic ignoring external notifications on message mentions.
  - `/profile/comments/[userId]` UNION query loader merging and sorting replies and activity comments.
  - `/api/drafts` (DELETE) / `/api/drafts/clear` (POST) to clear database drafts.
  - `/api/invitations` (GET) and `/api/invitations/request` (POST) checking monthly limit.
  - `/messages/[id]` server load handler (marks conversations as read) and `addParticipant` server action.
  - `/api/notifications` (GET & PUT) endpoints.
  - `/api/bookmarks` (GET) endpoint.
  - `/api/messages/recent` (GET) endpoint.
- **Frontend Components (Atomic):**
  - **Molecules:** `ParticipantAdder.svelte` autocomplete sidebar widget.
  - **Organisms:** Private message conversation stream window (no deletion modal, only edit).
  - **Pages (Frontend Views):**
    - `/messages/inbox` (messaging index thread list).
    - `/messages/new` (new thread composer page).
    - `/messages/:id/[[page=page]]` (PM detailed stream view with participant sidebar).
    - `/profile/comments/:userId/:userSlug` (User Comments list page).
    - `/profile/invitations` (User Invitations management page).
    - `/notifications` list.
    - `/bookmarks` list.
    - `/drafts` list with contextual jump-links.
- **Verification Checklist:**
  - Confirm entering discussion or PM pages marks active notifications as read.
  - Check PM autocomplete suggestions search.
  - Check draft deletion on successful creation.
  - Check comments page UNION query sorts items chronologically.
  - Verify mention notifications are bypassed on PM messages.
  - Verify that all select queries on private messages, notifications, and bookmarks apply Drizzle soft-delete filters (`isNull(...)`).

### Cycle 6: Seeding, E2E Testing & Release

- **Goal:** Execute database seeding and perform thorough end-to-end integration test validations.
- **Backend Modules (Atomic):**
  - Seeding script provisioning mock users, dummy discussions, categories, and test activities.
- **Verification Checklist:**
  - Verify zero `any` or `as any` patterns exist across `src`.
  - Validate that D1 indexes and composite keys prevent SQL table scans.
  - Verify all frontend page routes have correct title tags and meta descriptions for SEO.
  - Ensure fast Edge responses under Cloudflare local emulation.

---

## 5. Requirements Alignment Matrix

| Requirement Target            | Specifications File            | Development Cycle | Verification Target                                                              |
| :---------------------------- | :----------------------------- | :---------------- | :------------------------------------------------------------------------------- |
| **Strict Linter Check**       | `eslint.config.js`             | Cycle 1           | Pre-commit check blocks compilation on `any` / `as any` / `as unknown as`        |
| **pCloud Proxy XSS Shield**   | `RQ00-Backend.md` Section 4    | Cycle 3           | Excludes `image/svg+xml`, injects `nosniff` and `attachment` headers             |
| **Session Cookie**            | `RQ00-Backend.md` Section 3    | Cycle 1           | HTTPOnly, SameSite=Strict, secure JWT using HMAC SHA-256 with password redaction |
| **i18n System**               | `RQ00-Frontend.md` Section 8   | Cycle 1           | Accept-Language parsing, preferences, dictionary mapping                         |
| **Conditional Paginator**     | `RQ00-Frontend.md` Section 4.3 | Cycle 2           | Self-hides when total page count <= 1                                            |
| **Active Users Wall**         | `RQ00-Backend.md` Section 5.2  | Cycle 2           | Online API endpoint filters stealth and inactive users                           |
| **Autosave Drafts**           | `RQ00-Frontend.md` Section 5.3 | Cycle 2           | Background POST to `/api/drafts/save` every 30s                                  |
| **Vanilla Slugification**     | `RQ00-Backend.md` Section 5.1  | Cycle 3           | TypeScript port preserving Unicode, fallback to `'discussion'`                   |
| **SvelteKit Param Matcher**   | `RQ00-Backend.md` Section 6.7  | Cycle 3           | Matcher `/^p\d+$/` prevents route collisions in folders                          |
| **Daily Welcome Post**        | `RQ00-Backend.md` Section 5.3  | Cycle 4           | Deterministic ID `welcome-YYYY-MM-DD` catches PK duplication                     |
| **Profile Views Tracker**     | `RQ00-Backend.md` Section 6.3  | Cycle 4           | Increments on visit, excludes self-visits                                        |
| **Comments Union Query**      | `RQ00-Backend.md` Section 6.3  | Cycle 5           | Merges replies and activity comments, sorted chronologically                     |
| **Private Messages Deletion** | `RQ00-Frontend.md` Section 4.4 | Cycle 5           | PM message deletion is blocked; deletion confirmation modal omitted              |
| **Database Seeding**          | `RQ00-Backend.md` Section 7    | Cycle 1 / 6       | Provisions default roles & bootstrap admin                                       |

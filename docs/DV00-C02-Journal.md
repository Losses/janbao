# DV00-C02-Journal: Cycle 2 Development & Verification Journal

## 1. Executive Summary

This journal documents the design, implementation, and verification of **Cycle 2: Atomic UI Elements & Editor (Svelte 5 / Lexical / Mock APIs)** as defined in [RQ00-Plan.md](file:///home/losses/Development/janbao/docs/RQ00-Plan.md).

All code has been developed adhering to the strict architectural paradigms of **Atomic Component Design** on the frontend, **Atomic Backend Design** on the server, and under compile-time and lint-time type safety restrictions (prohibiting all `any`, `as any`, and `as unknown as` assertions).

---

## 2. Implemented Modules

### 2.1 Backend API Endpoints

- **[`/api/users/online` GET](file:///home/losses/Development/janbao/src/routes/api/users/online/+server.ts):** Active Users Wall endpoint.
  - Returns users active in the last 10 minutes (`lastActiveTime` > 10 minutes ago).
  - Excludes stealth mode users (`isStealth = false` filter).
  - Excludes the System User (`00000000-0000-0000-0000-000000000000`).
  - Returns: `id`, `username`, `displayName`, `avatarFileId`. Limited to 50 results.
  - Requires authentication (401 if not logged in).

- **[`/api/drafts/save` POST](file:///home/losses/Development/janbao/src/routes/api/drafts/save/+server.ts):** Draft upsert handler.
  - Accepts `contextType`, `contextId`, and `contentJson` in the request body.
  - Performs an atomic check-then-insert-or-update pattern.
  - Queries existing draft by composite key (`authorId` + `contextType` + `contextId`).
  - Updates `contentJson` and `updatedAt` if draft exists; inserts new row if not.
  - Requires authentication (401 if not logged in).

### 2.2 Frontend Atom Components (`src/lib/components/atoms/`)

- **[Avatar.svelte](file:///home/losses/Development/janbao/src/lib/components/atoms/Avatar.svelte):** Circular avatar with image or text-based fallback (first letter of displayName).
  - Supports sizes: `xs` (24px), `sm` (32px), `md` (40px default), `lg` (56px) via DaisyUI classes.
  - Self-conditional: renders fallback letter when `src` is null/undefined.

- **[Date.svelte](file:///home/losses/Development/janbao/src/lib/components/atoms/Date.svelte):** Human-friendly relative timestamp.
  - Displays relative time (e.g. "3 minutes ago", "2 days ago").
  - Native `title` attribute tooltip showing exact browser-localized date/time.
  - Renders as `<time>` element with `datetime` attribute for SEO/machine readability.

- **[Paginator.svelte](file:///home/losses/Development/janbao/src/lib/components/atoms/Paginator.svelte):** Minimalist page navigation.
  - **Self-conditional rendering:** renders nothing if `totalPages <= 1`.
  - Text-link style consistent with minimalist design. No button borders or backgrounds.
  - Ellipsis-based page number compression for large page counts.
  - Right-aligned by default. Each block keyed by index.

- **[Badge.svelte](file:///home/losses/Development/janbao/src/lib/components/atoms/Badge.svelte):** Status label component.
  - Supports variants: `primary`, `neutral`, `warning`, `accent`.
  - Uses DaisyUI badge classes (`badge-primary`, `badge-ghost`, etc.).

- **[LinkButton.svelte](file:///home/losses/Development/janbao/src/lib/components/atoms/LinkButton.svelte):** Minimalist hyperlink-styled button.
  - Renders as `<a>` when `href` is provided and not disabled; `<button>` otherwise.
  - Primary text color, bold on hover, 150ms transition.

- **[Logo.svelte](file:///home/losses/Development/janbao/src/lib/components/atoms/Logo.svelte):** Theme-aware logo.
  - Uses Material Design Icon (`mdiBookOpenPageVariant`) as the logo mark.
  - Text fallback "Janbao". Links to `/`.

- **[Icon.svelte](file:///home/losses/Development/janbao/src/lib/components/atoms/Icon.svelte):** Generic Material Design Icon SVG renderer.
  - Accepts `path` string (from `@mdi/js`), `size`, `class`, and `ariaLabel` props.
  - Renders inline SVG with proper `aria-hidden` / `role="img"` semantics.
  - All icons across the app use this component with `@mdi/js` path data.

- **[Tooltip.svelte](file:///home/losses/Development/janbao/src/lib/components/atoms/Tooltip.svelte):** Click-triggered popover overlay.
  - Click-outside dismissal via window listener.
  - Escape key dismissal via `onkeydown`.
  - `role="dialog"`, `tabindex="-1"` for accessibility.
  - Accepts `children` (trigger content) and `popover` (overlay content) snippets.

### 2.3 Frontend Molecule Components (`src/lib/components/molecules/`)

- **[UserInfoBlock.svelte](file:///home/losses/Development/janbao/src/lib/components/molecules/UserInfoBlock.svelte):** User info block combining avatar, display name, and icon button row.
  - Avatar + display name + @username.
  - 4 icon buttons: Notifications, Messages, Bookmarks, Settings.
  - Only one tooltip popover open at a time (mutual exclusion state management).
  - All icons use Material Design Icons via the Icon atom.

- **[NotificationTooltip.svelte](file:///home/losses/Development/janbao/src/lib/components/molecules/NotificationTooltip.svelte):** Notifications popover.
  - Header with "Notifications" label + settings link (`/profile/preferences`).
  - 5 mock notification items with read/unread styling.
  - Footer with "Show All" link to `/notifications`.

- **[MessageTooltip.svelte](file:///home/losses/Development/janbao/src/lib/components/molecules/MessageTooltip.svelte):** Messages popover.
  - Header with "Messages" label + "Send Message" link (`/messages/new`).
  - 5 mock conversation items with unread indicators.
  - Footer with "Show All" link to `/messages/inbox`.

- **[BookmarkTooltip.svelte](file:///home/losses/Development/janbao/src/lib/components/molecules/BookmarkTooltip.svelte):** Bookmarks popover.
  - Header with "Bookmarks" label.
  - 5 mock bookmarked discussion items.
  - Footer with "Show All" link to `/bookmarks`.

### 2.4 Frontend Organism Components (`src/lib/components/organisms/`)

- **[LexicalEditor.svelte](file:///home/losses/Development/janbao/src/lib/components/organisms/LexicalEditor.svelte):** Svelte-Lexical rich text editor wrapper.
  - **Markdown shortcuts:** H1-H4, bold, italic, underline, strikethrough, ordered/unordered/check lists, links.
  - **Protocol-level XSS validation:** Image source hotlinks restricted to `http://` and `https://` only. All other protocols (`javascript:`, `data:`, etc.) are rejected by the `validateImageSrc` function passed to `LinkPlugin`.
  - **Toolbar:** Block format dropdown (paragraph + H1-H4), bold/italic/underline/strikethrough, image upload, link, undo/redo.
  - **Configurable constraints:** `disableHeadings` (activity editor), `disableImageUpload` (PM editor).
  - **Context-aware autosave:** POSTs to `/api/drafts/save` every 30 seconds when content changes.
  - **Editor locking:** Shows spinner during draft loading.
  - **Structural typing:** Uses structural types for `onChange` callback to avoid cross-package `EditorState` type conflicts between our `lexical` dependency and `svelte-lexical`'s internal version.

### 2.5 Localization Updates

- **[en.json](file:///home/losses/Development/janbao/src/lib/i18n/en.json) & [zh-CN.json](file:///home/losses/Development/janbao/src/lib/i18n/zh-CN.json):**
  - Added `sidebar.*` keys (notifications, messages, bookmarks, settings, sendMessage, showAll, createDiscussion, etc.).
  - Added `editor.*` keys (placeholder variants, saving states, toolbar labels).
  - Added `pagination.*` keys (previous, next, page).
  - Added `date.*` keys (relative time labels).
  - Added `common.*` keys (loading, saving, saved, cancel, confirm, delete, edit, reply, submit, showAll, noResults).

### 2.6 Dependencies Added

- **`svelte-lexical`** (v0.6.4): Svelte 5 wrapper for the Lexical rich text editor.
- **`lexical`** (v0.45.0): Meta's Lexical editor framework.
- **`@mdi/js`** (v7.4.47): Material Design Icons SVG path data.

### 2.7 Codebase Health Fixes (Cycle 1 Regressions)

- **[db/index.ts](file:///home/losses/Development/janbao/src/lib/server/db/index.ts):** Removed circular type reference. Simplified to export only `D1Db` type and `DbTransaction`. Removed broken `BunSqliteDb` local dev support that caused type conflicts.
- **[hooks.server.ts](file:///home/losses/Development/janbao/src/hooks.server.ts):** Simplified to require D1 binding only, removing the `getLocalDb` fallback that caused type errors.
- **[seed.ts](file:///home/losses/Development/janbao/src/lib/server/db/seed.ts):** Updated `Database` type import to `D1Db`.

---

## 3. Verification & Code Safety Compliance

- **Type Check:** `bun run check` — 897 files, 0 errors, 0 warnings.
- **Lint:** `bun run lint` (Prettier + ESLint) — Clean, zero errors.
- **Strict Typing:** Zero occurrences of `any`, `as any`, or `as unknown as` across all new files.
- **Icon System:** All inline SVG icons replaced with Material Design Icons via `@mdi/js` + Icon atom component. No hand-drawn SVG icons remain.

---

## 4. Audit & Quality History

_Audit rounds to be appended after independent agent review._

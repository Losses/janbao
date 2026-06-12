# RQ0-Frontend: Frontend Architecture Document

## 1. System Overview & Technology Stack

The Janbao Forum System frontend is architected as a modern, high-performance web application utilizing **SvelteKit** (v2) and **Svelte** (v5) with Runes mode enabled. 

### Core Technologies
- **UI Framework:** Svelte 5 (utilizing `$state`, `$derived`, `$effect` runes)
- **Application Framework:** SvelteKit 2 (using filesystem-based routing, server-side rendering, and server actions)
- **Styling Engine:** TailwindCSS v4 with DaisyUI v5
- **Rich Text Editor:** `svelte-lexical` (based on Lexical editor framework)
- **Icons:** Material Design Icons (SVG-based, integrated via custom Svelte components to avoid external resource load)

---

## 2. Design System & Aesthetics

The design principles of Janbao Forum are defined by high restraint, minimalism, and visual elegance. Color and animation are treated as scarce resources to avoid visual noise and focus the user's attention on content.

### 2.1 Restrained Color Palette
Only four semantic colors are permitted globally:
1. **Primary Color:** Used for active states, key interactive buttons (like bookmark status, unread reply counts, and selected items), and focal typography.
2. **Neutral Color:** Used for the base interface, structural grids, backgrounds, borders, and general body text.
3. **Accent Color:** Used sparingly for special highlights, interactive hover states, or subtle focus rings.
4. **Warning Color:** Restricted exclusively to destructive actions (such as deletion confirmation triggers or error indicator states).

No extraneous colors or random palettes are allowed. Components must strictly consume Tailwind/DaisyUI semantic color utility classes.

### 2.2 Typography
The application uses modern, clean typography configured in TailwindCSS:
- **Primary Font Family:** `Inter`, `system-ui`, `-apple-system`, `sans-serif` (imported locally/self-hosted to avoid Google Fonts privacy issues).
- **Size Scale:** Strict modular scale from `text-xs` to `text-3xl`.

### 2.3 Animations & Transitions
- **Strict Prohibition:** All decorative, non-functional animations are prohibited.
- **Permitted Interactions:** Standard CSS-based micro-transitions on interactive components (`transition-colors`, duration 150ms, ease-out) for buttons, list items, and form elements. No bouncy animations or page slide transitions.

### 2.4 DaisyUI Dynamic Theme Resolution
The platform supports category-specific and discussion-specific DaisyUI themes.
1. **Resolution Hierarchy:** Discussion Theme (highest priority) -> Category Theme -> Default User Preferred Theme -> System Theme (browser default).
2. **Server-Side Rendering (SSR) Strategy:**
   - The resolved theme name is injected at the server level via SvelteKit’s `hooks.server.ts` or layout `load` functions.
   - The theme is rendered directly into the HTML tag: `<html data-theme="{resolvedTheme}">` to prevent client-side layout thrashing or theme flashing during page load.

---

## 3. Layout Strategy & Core Structure

The site enforces a responsive grid that values whitespace and screen ergonomics.

```
+---------------------------------------------------------+
|                         Header                          |
+---------------------------------------------------------+
|                  Main Container (Max 960px)             |
|  +--------------------------------+  +---------------+  |
|  |                                |  |               |  |
|  |                                |  | Right Sidebar |  |
|  |           Page Content         |  |   (320px)     |  |
|  |           (Dual Column)        |  |               |  |
|  |                                |  +---------------+  |
|  +--------------------------------+                     |
+---------------------------------------------------------+
```

### 3.1 Adaptive Column System
- **Wide Screens (>= 768px):** Dual-column layout. The overall page container is restricted to `max-width: 960px` centered on the screen, with padding on the left and right. The main content column takes up the left portion, and the fixed-width sidebar (`320px`) occupies the right.
- **Narrow/Mobile Screens (< 768px):** Single-column layout. The sidebar collapses and becomes accessible as an off-canvas drawer that slides out from the right upon tapping the user profile avatar in the header.

### 3.2 Main Layout Components
1. **Header:**
   - **Logo Component:** Renders either a custom SVG logo (tailored to the active DaisyUI theme) or fallback pure text.
   - **Main Navigation:** Direct links to Home (`/`), Categories (`/categories`), Activity Square (`/activity`), and Messages (`/messages/inbox`).
2. **Right Sidebar:**
   - **User Info Block:** Renders the current user's profile.
     - Left: `Avatar` component (circular profile picture).
     - Right (top): User Profile display name.
     - Right (bottom): Row of 4 icon buttons: Notifications, Private Messages, Bookmarks, and Settings.
   - **Tooltip Popups:** Clicking Notifications, Private Messages, or Bookmarks triggers a local tooltip overlay.
     - **Constraint:** Renders exactly the 5 most recent items.
     - **Action Links:** Headers contain text buttons linking to detailed configuration or creation pages. The footer contains a "Show All" link.
     - **Favorite Bookmarks:** Bookmarks tooltip displays the recently bookmarked discussions (requires recording bookmark time in the database).
   - **Create Discussion Button:** Large primary button routing to `/post/discussion`.
   - **Category Widget:** A vertical navigation list of categories.
   - **Quick Links:** Shortcuts to "My Discussions" (`/discussions/mine`) and "My Drafts" (`/drafts`).
   - **Active Users Wall:** A grid of user avatars representing users who made a read request within the last 10 minutes. If the user has enabled Stealth Mode, they are hidden from this wall.

---

## 4. Reusable Frontend Components

### 4.1 Avatar Component
- A circular container rendering the user's uploaded avatar image or a text-based fallback (first letter of username) if no avatar is set.
- Supported in multiple sizes (`xs`, `sm`, `md`, `lg`) using CSS sizing variables.

### 4.2 Date Component
- Renders dates in a human-friendly relative format (e.g., "3 minutes ago", "2 days ago", "1 year ago").
- Built-in tooltip wrapper: hovering over the relative date text displays the exact browser-localized date and time (e.g., "YYYY-MM-DD HH:mm:ss").

### 4.3 Paginator Component
- Renders page numbers without button borders or backgrounds, using a text-link style consistent with the minimalist theme.
- **Self-Conditional Rendering:** The component checks the total page count. If `totalPages <= 1`, it returns empty markup (`null` render) automatically, preventing redundant layout noise.
- Default alignments: Right-aligned on content lists.

### 4.4 Confirmation Modal Component
- Standardized modal for destructive actions (deletions of posts, activities, messages, comments, etc.).
- Wrapped dynamically. It requires a `title`, a `message` explaining the deletion context, and callbacks for `onConfirm` and `onCancel`. Renders using standard accessibility traits (ARIA focus traps).

---

## 5. Rich Text Editor (`svelte-lexical`)

Rich text editing across the forum is powered by Svelte wrappers around the Lexical engine, customized to enforce the design system.

### 5.1 Configuration & Markdown Support
- **Supported Formats:** H1 to H4 headers, bold, italic, underline, strikethrough, marker highlight, image uploads, and external image hotlinking.
- **Activity Editor Constraint:** The editor loaded on the Activity Square page (`/activity`) blocks all headers (H1-H4) and forces single-level body paragraph structures.
- **Upload Action:** Integrated with the backend `/upload` proxy route. Uploading an image triggers a `FormData` upload request, yielding the local proxied URL `https://${host}/img/${fileid}` which is embedded into the editor nodes.

### 5.2 User Mention Chip (`@mention`)
- Triggers on typing the `@` character.
- Invokes a search query against the global user directory to return matched users in a dropdown overlay.
- Clicking a user inserts a non-editable mention node (styled as a custom CSS chip).
- Clicking the "Reply" button on any post or comment automatically focuses the editor, scrolls the window to it, and appends the target author's `@username` mention node at the end of the content.

### 5.3 Context-Aware Draft Autosave
- The rich text editor triggers a background autosave request to `/api/drafts/save` every 30 seconds.
- **Context Association:** Drafts are saved along with their specific context (e.g., specific `discussionId` for reply drafts, `categoryId` for discussion drafts, `conversationId` for private message drafts).
- **UX Loading Block:** Upon loading an editor, the system fetches active drafts for the matching context. During this network check, the editor is disabled, showing a loader, and is unlocked once the check completes. If a draft is found, it automatically overwrites the editor state.

---

## 6. Page Routing & Client-Side Views

### 6.1 Home (`/`)
- Displays a unified list of discussions across all categories.
- Includes pagination at the top and bottom.

### 6.2 Category List (`/categories`)
- Highly simplified index displaying category rows.
- Each row contains the Category Title link and a short description.

### 6.3 Category Discussions (`/category/:categorySlug`)
- Displays the discussion list within the category.
- **Discussion List Item Components:**
  - Left: User avatar.
  - Center: Discussion title (link) above a metadata row (author, views, replies, last replier, updated date).
  - Right: Star bookmark toggle button.
  - **Read/Unread Status:** If the discussion has new replies since the user's last read timestamp, the row displays without a background and renders a primary-colored badge with the unread count. If read, it displays with a light background.
  - **Pin State:** Pinned discussions show a label before the author. Color scheme: background = text color, text color = page background.

### 6.4 Discussion Details (`/discussion/:discussionId/slug/(p:page)#:replyId`)
- **Page 1 Layout:** Renders the main discussion title, the original post content, a paginator, the replies stream, another paginator, and the reply editor.
- **Page 2+ Layout:** Hides the original post content; only displays the replies stream and the editors.
- **Navigation Anchor:** If `replyId` is provided in the URL fragment (`#:replyId`), SvelteKit triggers an automatic smooth scroll directly to the corresponding reply node after rendering completes.
- **Theme Override:** Applies the discussion’s custom theme (if configured), overriding any category-wide theme.

### 6.5 Private Messages (`/messages/inbox` & `/messages/:id/(p:page)#:replyId`)
- Inbox replicates the layout of the category discussions view.
- Detail pages display the private message streams.
- **Special Sidebar:** Displays avatars and names of all participants instead of regular widgets.
- **Participant Adder Widget:** Includes an autocomplete input box to search and append new participants as chips. Clicking "Add" posts an update to the backend, enabling the new user to view the full dialogue history.

### 6.6 Activity Square (`/activity`)
- Contains a header paragraph editor (no formatting headers allowed) to post new microblogs.
- Supports target addressing: User A -> User B.
- **Comments Block:** Renders 1-level deep nested comments with a light background. Deleting a comment opens the deletion confirmation modal.

### 6.7 Profile views (`/profile/:id/:slug`, `/profile/edit`, `/profile/password`, `/profile/preferences`, `/profile/picture`, `/profile/OnlineNow`)
- Renders user statistics and their dynamic activity logs.
- Preferences page displays toggle options for mentions, replies, messages, and comment notifications.
- Password change forces a strength check requiring a minimum of 5 characters.
- Picture page handles avatar uploads restricted to a maximum size of 1MB.
- OnlineNow manages stealth visibility toggling.

---

## 7. Internationalization (i18n)

Janbao Forum uses a static i18n dictionary system to avoid hardcoded UI strings.
- **Supported Languages:** English (`en`) and Simplified Chinese (`zh-CN`).
- **Resolution Flow:**
  1. If the authenticated user has configured a language preference in their profile database record, use that preference.
  2. If not authenticated or no preference is set, parse the `Accept-Language` request header from the browser.
  3. Fallback to English (`en`).
- **Implementation:** SvelteKit layout load functions fetch translation keys and provide them to components via page stores, ensuring reactive translation rendering.

---

## 8. Client Performance & Optimization

1. **Mention Suggestion Cache:** User lookup lists are cached in memory for the duration of the editing session to minimize API roundtrips.
2. **Debounced/Throttled Actions:** Typing updates to drafts are throttled to a strict 30-second interval. Bookmark clicks are debounced (300ms) to prevent double-click database spikes.
3. **Edge Asset Caching:** Uploaded images and avatars from the pCloud proxy service `/img/:fileid` are configured with a `Cache-Control` header of 1 year, allowing browsers and Cloudflare CDN edges to cache assets permanently.

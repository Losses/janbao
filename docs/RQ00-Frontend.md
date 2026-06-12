# RQ00-Frontend: Frontend Architecture Document

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
- **Entry Layout Exception (`/entry/*`):** All sign-in, registration, and logout routes are forced into a single-column layout centered on the screen, without any right sidebar or sidebar drawer.

### 3.2 Header Layout
- **Logo Component:** Renders either a custom SVG logo (tailored to the active DaisyUI theme) or fallback pure text.
- **Main Navigation:** Direct links to Home (`/`), Categories (`/categories`), Activity Square (`/activity`), and Messages (`/messages/inbox`).

### 3.3 Sidebar Layout Variations
The Right Sidebar remains fixed in size but changes content dynamically based on the active route:
1. **Forum Routes (`/`, `/categories`, `/category/:slug`, `/discussion/:id`):**
   - **User Info Block:** Renders current user's profile (avatar, display name, and row of 4 icon buttons: Notifications, PMs, Bookmarks, and Settings).
   - **Create Discussion Button:** Primary button routing to `/post/discussion`.
   - **Category List Widget:** Vertical navigation list of categories.
   - **Quick Links:** Shortcuts to "My Discussions" (`/profile/discussions/:userId/:userSlug`) and "My Drafts" (`/drafts`).
   - **Active Users Wall:** Avatar wall of users active in the last 10 minutes (respecting stealth mode).
2. **Profile Routes (`/profile/*`):**
   - The Profile sidebar is split into two layout states depending on the target user context:
     - **Owner View (active when `currentUserId === profileOwnerId`):** Renders the full functional menu sidebar containing:
       - Dynamics (`/profile/:userId/:userSlug`)
       - Notifications (`/notifications`)
       - Invitations (`/profile/invitations`)
       - Mailbox/PMs (`/messages/inbox`)
       - Discussions (`/profile/discussions/:userId/:userSlug`)
       - Comments (`/profile/comments/:userId/:userSlug`)
       - Account Settings shortcuts nested below (Edit Account, Change Password, preferences, avatar, stealth settings).
     - **Visitor View (active when viewing another user's profile):** Renders *only* public navigation widgets:
       - Dynamics (`/profile/:userId/:userSlug`)
       - Discussions (`/profile/discussions/:userId/:userSlug`)
       - Comments (`/profile/comments/:userId/:userSlug`)
       - Hides all private paths (Notifications, Invitations, Mailbox/PMs) and settings widgets.
3. **Private Messages Inbox (`/messages/inbox`, `/messages/new`):**
   - Renders a "Send Private Message" button and the active users wall.
4. **Private Message Details (`/messages/:id`):**
   - **Special PM Sidebar:** Displays avatars and nicknames of all conversation participants.
   - **Participant Adder Widget:** Auto-complete text input with search suggestions. Add users as chips. Pressing the "Add" button sends a call to the backend to add the user.
5. **Activity Square (`/activity`):**
   - Sidebar is left completely empty as specified.
6. **Entry Views (`/entry/*`):**
   - Sidebar is completely disabled.

### 3.4 User Info Block Popover Tooltips
Clicking the row icon buttons inside the User Info Block triggers absolute-positioned overlay tooltips:
1. **Notifications Tooltip:**
   - Queries `/api/notifications?limit=5` to fetch the 5 most recent notification records.
   - Layout: Header displaying "Notifications" with a tiny settings button (linking to `/profile/preferences`); list of notification items; footer containing a "Show All" link pointing to `/notifications`.
2. **Private Messages Tooltip:**
   - Queries `/api/messages/recent?limit=5` to fetch the 5 most recent active PM conversations.
   - Layout: Header displaying "Messages" with a "Send Message" button (linking to `/messages/new`); list of conversation items; footer containing a "Show All" link pointing to `/messages/inbox`.
3. **Bookmarks Tooltip:**
   - Queries `/api/bookmarks?limit=5` to fetch the 5 most recent bookmarked discussions.
   - Layout: Header displaying "Bookmarks" with title text; list of bookmarked titles; footer containing a "Show All" link pointing to `/bookmarks`.
4. **Settings Icon Button:**
   - Clicks on the Settings icon link route the user directly to the Account Edit page (`/profile/edit`).

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
- Standardized modal for destructive actions (deletions of posts, activities, comments, etc.).
- Wrapped dynamically. It requires a `title`, a `message` explaining the deletion context, and callbacks for `onConfirm` and `onCancel`. Renders using standard accessibility traits (ARIA focus traps).
- **Scope Restriction:** PM messages can be edited by their authors but cannot be deleted by users. Thus, this modal is not applicable to PM messages.

### 4.5 DiscussionMetadata Component
- Displays a unified header for threads and replies.
- Layout: Left is Avatar; right is a vertical stack:
  - Top: User Display Name (links to `/profile/:userId/:userSlug`).
  - Bottom: Relative date (via `Date` component), last edited indicator (if edited), and an optional Category Name link (only shown on the original post).

### 4.6 LinkButton Component
- A unified minimalist link styled to look like text but functioning as an interactive button.
- Used in footer metadata blocks, inline comments, and lists. Enforces primary text color, bold font on hover, and light default color.

---

## 5. Rich Text Editor (`svelte-lexical`)

Rich text editing across the forum is powered by Svelte wrappers around the Lexical engine, customized to enforce the design system.

### 5.1 Configuration & Markdown Support
- **Supported Formats:** H1 to H4 headers, bold, italic, underline, strikethrough, marker highlight, image uploads, and external image hotlinking.
- **Activity Editor Constraint:** The editor loaded on the Activity Square page (`/activity`) and profile activity composer blocks all headers (H1-H4) and forces single-level body paragraph structures.
- **Private Message Constraint:** The PM editor disables local image uploading (the upload action/button is hidden). Users can only insert external images via URL hotlinking.
- **Image URL Validation:** The Svelte-Lexical parser/renderer enforces strict protocol validation on hotlinked image source URLs. Only links prefixing `http://` or `https://` are permitted; all others (such as `javascript:` or data-URIs) are rejected to prevent Stored XSS.
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
- **Draft Cleanup:** Upon successful submission of a post, reply, or message, the local cache and backend database are cleared of the corresponding draft.

---

## 6. Page Routing & Client-Side Views

### 6.1 Home (`/`)
- Displays a unified list of discussions across all categories.
- Default Pagination: Renders exactly 20 discussions per page.
- Includes pagination at the top and bottom.

### 6.2 Category List (`/categories`)
- Highly simplified index displaying category rows.
- Each row contains the Category Title link and a short description.

### 6.3 Category Discussions (`/category/:categorySlug`)
- Displays the discussion list within the category.
- Default Pagination: Renders exactly 20 discussions per page.
- **Paginators:** A `Paginator` component is rendered at both the top and the bottom of the discussion list.
- **Discussion List Item Components:**
  - Left: User avatar.
  - Center: Discussion title (links to the discussion, using reading history to build the exact page and reply ID URL, e.g., `/discussion/:id/slug/p2#reply-123`). Under the title: author, views, replies, last replier, updated date.
  - Right: Star bookmark toggle button (primary color if active).
  - **Read/Unread Status:** If the discussion has new replies since the user's last read timestamp, the row displays without a background and renders a primary-colored badge with the unread count. If read, it displays with a light background.
  - **Pin State:** Pinned discussions show a label before the author. Color scheme: background = component text color, text color = component background.
  - **RSS Subscription:** An RSS subscription link/icon is placed near the category title, pointing to `/category/:categorySlug/rss?token=USER_RSS_TOKEN`.

### 6.4 Discussion Details (`/discussion/:discussionId/slug/[[page=page]]#:replyId`)
- Optional `page` parameter uses SvelteKit parameter matchers (e.g. matching `p[0-9]+` to validate integer pages, routing folder structured as `[[page=page]]`) to prevent collisions with actions.
- Default Pagination: Renders exactly 50 replies per page.
- **Page 1 Layout:** Renders the main discussion title, the original post content, a paginator, the replies stream, another paginator, and the reply editor.
- **Page 2+ Layout:** Hides the original post content; only displays the replies stream and the editors.
- **Navigation Anchor:** If `replyId` is provided in the URL fragment (`#:replyId`), SvelteKit triggers an automatic smooth scroll directly to the corresponding reply node after rendering completes.
- **Theme Override:** Applies the discussion’s custom theme (if configured), overriding any category-wide theme.

### 6.5 Private Messages (`/messages/inbox`, `/messages/new` & `/messages/:id/[[page=page]]#:replyId`)
- **Inbox:** Replicates the layout of the category discussions view but displays active threads. Includes pagination at the top and bottom.
- **New Conversation (`/messages/new`):** Contains an autocomplete recipient search field allowing multiple user chips to be entered, along with a rich text editor (without upload capabilities). Pressing "Send" creates the thread.
- **PM Detail View:** Displays the message stream. Messages can be edited by the author but cannot be deleted. The sidebar displays all participants with an auto-complete box to add new contacts.
- **Deletion Scope:** The deletion confirmation modal is not available on PM views.

### 6.6 Activity Square (`/activity`)
- Contains a header paragraph editor (no formatting headers allowed) to post new microblogs.
- Has no recipient or target user selector in the main editor.
- Default Pagination: Renders exactly 15 activity items per page.
- **Comments Block:** Clicking "Comment" on an activity opens an inline editor directly below the post. Sub-comments are displayed in a single-level nested comment block (no further nesting) with a light background. Deleting an activity comment opens the deletion confirmation modal.

### 6.7 Profile Views (`/profile/:userId/:userSlug`)
- **Metadata Subheader:** Displays user statistics including join date, profile view count (increments on visit), last active time, and user group.
- **Directed Activity Composer:** The bottom of the profile page features a full rich text editor. Typing and submitting here posts a directed activity (`User A -> User B`) directly to the target user's profile stream.
- **Settings Routes:** Includes `/profile/edit` (username input disabled unless logged-in user is an admin), `/profile/password` (password strength validation enforces a minimum of 5 characters), `/profile/preferences` (toggles for PMs, bookmarks, mentions, and replies), `/profile/picture` (avatar upload <= 1MB), and `/profile/OnlineNow` (stealth settings).

### 6.8 New Discussion (`/post/discussion`)
- Features inputs for Title, Category selector (which defaults to the category with the highest `priority` value), Theme dropdown, and a full `svelte-lexical` editor.
- Bottom actions: "Publish" (POST to backend API), "Save Draft" (manual override for autosave), and "Preview" (renders a read-only Svelte components mockup container).

### 6.9 User Discussions Page (`/profile/discussions/:userId/:userSlug`)
- Displays all discussions authored by the target user in a paginated list layout identical to `/category/:slug` (20 items per page).

### 6.10 My Drafts (`/drafts`)
- Displays a lists of active drafts. 
- Filters drafts to only show thread creation drafts and discussion replies (filtering out private message or activity drafts).
- Each entry contains a contextual jump-link pointing directly back to the creation/reply target (e.g. linking to `/post/discussion` with draft ID parameters, or `/discussion/:id/slug/p1` with active editor states).

### 6.11 Notifications Page (`/notifications`)
- Accessible via the "Show All" link in the notifications tooltip.
- Renders a clean list of all user notifications, sorted by timestamp, showing the event details (e.g., "@user replied to your post") with links to the context. Contains a "Mark all as read" button.

### 6.12 Bookmarked Discussions (`/bookmarks`)
- Accessible via the "Show All" link in the bookmarks tooltip.
- Displays a paginated list of all conversations bookmarked by the user, sorted by bookmark timestamp.

### 6.13 User Comments Page (`/profile/comments/:userId/:userSlug`)
- Displays a list of all comments and replies published by the target user.
- **Layout:** Individual comments are stacked vertically.
  - **Top:** The comment body content rendered via the Lexical renderer.
  - **Bottom:** Small, light text containing context indicators:
    - If the comment is a discussion reply: displays "Reply in: Discussion Title" (links directly to the discussion detail view).
    - If the comment is an activity comment: displays "Comment on Activity" (links back to the parent Activity Square post anchor).
    - Relative date of the comment (via the `Date` component).

### 6.14 User Invitations Page (`/profile/invitations`)
- Accessible only to the logged-in user.
- **Header:** Informative text displaying the current month's allowance: "This month you have N invitation codes."
  - Includes a prominent "Request Invitation Code" button. Clicking this triggers a POST call to `/api/invitations/request` and reactively updates the list. If the monthly limit is exceeded, the button shows a disabled, muted state.
- **Invitations Table:** Lists all invitation codes requested or owned by the user. Columns include:
  - **Code:** The invitation code string.
  - **Used By:** Username/Link of the user who registered using this code (displays "Unused" if empty).
  - **Requested At:** Date requested (using the Date component).
  - **Status:** Badge reflecting the status: 'Used' (primary color), 'Unused' (neutral), or 'Expired' (warning color). Status is dynamically resolved on fetch depending on expiration time bounds.
  - **Expires At:** Expiry date (using the Date component).

---

## 7. Entry Routes (Authentication Views)

These views reside under the `/entry/*` path, rendering in a single-column container without any sidebars or drawers.

### 7.1 Sign-In View (`/entry/signin`)
- Form components:
  - Username or Email text field.
  - Password password field.
  - "Remember Me" checkbox.
  - "Log In" submit button.
- Submitting posts data to the `/api/auth/login` endpoint, specifying remember-state age configuration.

### 7.2 Registration View (`/entry/register`)
- Form components:
  - Invitation Code text field.
  - Username text field.
  - Password password field.
  - Confirm Password password field.
  - "Register" submit button.
- Submitting posts data to `/api/auth/register`. Enforces client password validation parameters.

### 7.3 Logout View (`/entry/signout`)
- Confirmation prompt: "Are you sure you want to log out?"
- Buttons: "Confirm Logout" (POST to logout endpoint) and "Cancel" (redirects back to previous page).

---

## 8. Internationalization (i18n)

Janbao Forum uses a static i18n dictionary system to avoid hardcoded UI strings.
- **Supported Languages:** English (`en`) and Simplified Chinese (`zh-CN`).
- **Resolution Flow:**
  1. If the authenticated user has configured a language preference in their profile database record, use that preference.
  2. If not authenticated or no preference is set, parse the `Accept-Language` request header from the browser.
  3. Fallback to English (`en`).
- **Implementation:** SvelteKit layout load functions fetch translation keys and provide them to components via page stores, ensuring reactive translation rendering.

---

## 9. Client Performance & Optimization

1. **Mention Suggestion Cache:** User lookup lists are cached in memory for the duration of the editing session to minimize API roundtrips.
2. **Debounced/Throttled Actions:** Typing updates to drafts are throttled to a strict 30-second interval. Bookmark clicks are debounced (300ms) to prevent double-click database spikes.
3. **Edge Asset Caching:** Uploaded images and avatars from the pCloud proxy service `/img/:fileid` are configured with a `Cache-Control` header of 1 year, allowing browsers and Cloudflare CDN edges to cache assets permanently.

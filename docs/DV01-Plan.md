# DV01-Plan: QA Issue Resolution & Feature Alignment Plan

## 1. Executive Summary

This document outlines the atomic development plan to resolve the QA bugs, layout issues, and permission gaps identified in the QA audit report. We analyze the discrepancies between the requirements defined in [RQ00-Frontend.md](file:///home/losses/Development/janbao/docs/RQ00-Frontend.md) and [RQ00-Backend.md](file:///home/losses/Development/janbao/docs/RQ00-Backend.md), and partition the remediation work into six sequential, manageable **Development Cycles**.

To maintain codebase health and architectural integrity:

- **All components** must follow the **Atomic Component Design** paradigm.
- **All Lexical features** (Auto-link, Link creation, Spoilers) must be securely handled at the AST and renderer levels.
- **Strict Linting Rules** are maintained to ensure zero `any` usage.

---

## 2. Identified Discrepancies & Issues

Based on a detailed audit of the repository, the following issues from the QA audit report are mapped to codebase locations:

1. **Header Component Missing (QA #1, #3):**
   - _Issue:_ No general header component exists in the codebase. Mobile users on non-home pages have no header, leading to an inaccessible sidebar drawer.
   - _Discrepancy:_ `RQ00-Frontend.md` Section 3.2 specifies a Header Layout, but the implementation omitted it entirely.
   - _Remediation:_ Create a global `Header` component and integrate it within layouts. Add a mobile drawer toggle button in the header.

2. **Tooltip Alignment (QA #2):**
   - _Issue:_ Tooltips under the username row are right-aligned (`absolute right-0` in `Tooltip.svelte`), making them look unbalanced.
   - _Remediation:_ Update `Tooltip.svelte` to support center alignment (using `left-1/2 -translate-x-1/2`).

3. **Discussion Page & New Message Page Usability (QA #4, #5):**
   - _Issue A:_ `/post/discussion` wraps the editor in `SingleColumnLayout.svelte`, which is limited to `max-w-md` (480px), squishing the editor.
   - _Issue B:_ When a draft is loaded from the backend, the `contentJson` state in Svelte pages remains an empty string `''` until the first keystroke. This causes the submit buttons ("Publish" and "Send") to remain disabled by default.
   - _Remediation:_ Use `DualColumnLayout.svelte` (without a sidebar snippet) for `/post/discussion` to allow a full `960px` max width. Synchronize the page's editor content state with `initialContent` immediately upon editor initialization.

4. **Sidebar Missing Online Users (QA #6):**
   - _Issue:_ `ActiveUsersWall.svelte` is only included in the new message sidebar, and is missing from all forum page sidebars (Home, Category, Discussion).
   - _Remediation:_ Include `ActiveUsersWall` in the default sidebar widget layout.

5. **Redundant "首页" Title (QA #7):**
   - _Issue:_ The Home page (`src/routes/+page.svelte`) displays a redundant `<h1>{t.nav.home}</h1>` header banner.
   - _Remediation:_ Remove the redundant Home page title banner.

6. **Mention Resolution & Chip Rendering (QA #8):**
   - _Issue:_ Text mentions (e.g. `@username`) are saved as plain text. There is no mechanism to resolve these to display names (nicknames) and render them as Svelte chips.
   - _Remediation:_ Update backend load handlers to parse mentioned usernames, query their display names, and return a `mentionedUsers` map. Modify `LexicalRenderer.svelte` to replace plain-text mentions with styled inline badges/chips using the resolved display names.

7. **Chinese-to-English translation of "动态" (QA #9):**
   - _Issue:_ "动态" is translated as "Dynamics" in translation key `dynamics` and Svelte template references.
   - _Remediation:_ Rename translation keys from `"dynamics"` to `"activities"` in localization files, and refactor all Svelte templates referencing `profileT.dynamics` to use `profileT.activities`. Ensure that "Dynamic" is completely purged from codebase/database references related to activities to avoid historical debt.

8. **Lexical Hyperlink Features (QA #10):**
   - _Issue:_ Raw URLs are not automatically linkified, and link insertion for selected text is unsupported or buggy.
   - _Remediation:_ Integrate auto-link plugin capability and ensure link creation on highlighted text functions correctly in the toolbar.

9. **Lexical Spoiler Text Style (QA #11):**
   - _Issue:_ There is no support for Spoiler inline text styling.
   - _Remediation:_ Define a Spoiler inline text style (`bg-current text-current hover:text-base-content hover:bg-transparent transition-colors duration-200 cursor-pointer`). Add a Spoiler button to the Lexical toolbar and support its rendering in `LexicalRenderer.svelte`.

10. **Cluttered Profile & Settings Sidebars (QA #12):**
    - _Issue:_ Settings routes and user profile pages mechanically share the exact same sidebar menu. Profile activity navigation and private account configurations are cluttered together.
    - _Remediation:_ Separate them. Create two distinct navigation sidebar menus: **Profile Navigation Sidebar** (for Activities, Notifications, Invitations, Mailbox, Discussions, Comments) and **Settings Navigation Sidebar** (for Edit Account, Change Password, Notification Preferences, Change Avatar, Online Status). Settings pages only render the Settings Sidebar; profile/user-related pages only render the Profile Sidebar.

11. **Guest Group & Invincible Default Permissions (QA #13):**
    - _Issue:_ Unlogged guests are default-mapped to the `'member'` user group during category CRUD checks. This gives guests member privileges ("god mode"), allowing them to view and create in member-only categories.
    - _Remediation:_ Define a dedicated `'guest'` role in `userGroups`. For guest requests (`user` is null), fallback to `groupSlug = 'guest'` instead of `'member'`. Configure category permission logic: if no database record exists, guest defaults to `canRead = true` (open/public categories), but `canCreate = false`, `canUpdate = false`, and `canDelete = false`. Admins/moderators default to CRUD `true`, and members default to read/create `true` but update/delete `false`.

12. **OP Sticky / Unsticky Action & Permissions (QA #14):**
    - _Issue:_ There is no functional sticky/unsticky button, and users cannot change discussion sticky (`isPinned`) status.
    - _Remediation:_ Add a "置顶" (Sticky) / "取消置顶" (Unsticky) link next to the "编辑" (Edit) button on the OP. Restrict visibility and capability strictly to users who have category-level `canDelete` permissions. Implement a `togglePin` SvelteKit server action on the discussion details page route.

---

## 3. Development Cycles

### Cycle 1: Layout, Header System & Sidebar Refactoring (QA #1, #3, #7, #12)

- **Goal:** Implement the global Header component, integrate it into layouts with drawer-toggle behavior, remove the redundant home page title, and separate the user profile and account settings sidebars.
- **Tasks:**
  - Create `Header.svelte` in `src/lib/components/organisms/` containing:
    - SVGs/Logo tailored to the active DaisyUI theme.
    - Navigation items: Home (`/`), Categories (`/categories`), Activity Square (`/activity`), Messages (`/messages/inbox`).
    - UserInfo status or Sign-in/Register links when unauthenticated.
    - Mobile menu button (`md:hidden`) that binds to and opens the sidebar drawer.
  - Render the global `Header` directly inside `DualColumnLayout.svelte` (at the top of the flex container). This naturally excludes `/entry/*` routes (which use `SingleColumnLayout`) and simplifies the `$bindable` drawer state binding for `isDrawerOpen` without complex layout context stores.
  - Edit `src/routes/+page.svelte` to remove the redundant `<h1>{t.nav.home}</h1>` block.
  - Refactor sidebar layout logic in profile routes:
    - **Profile Navigation Sidebar** (rendered on `/profile/[userId]/[userSlug]`, `/notifications`, `/profile/invitations`, `/messages/inbox`, `/bookmarks`, `/drafts`, `/profile/discussions/*`, `/profile/comments/*`). Displays links to: Activities, Notifications (owner only), Invitations (owner only), Mailbox (owner only), Discussions, Comments, and a separate "Account Settings" button.
    - **Settings Navigation Sidebar** (rendered on settings pages `/profile/edit`, `/profile/password`, `/profile/preferences`, `/profile/picture`, `/profile/onlineNow`). Displays links to: Edit Account, Change Password, Notification Preferences, Change Avatar, Online Status, and a separate "Back to Profile" button.
    - **Owner vs. Visitor View Guard:** Implement Svelte check logic inside the Profile Sidebar. If the target `profileOwnerId` does not match the active `currentUserId`, hide all private navigation options (Notifications, Invitations, Mailbox) and account settings buttons. Update public links (Activity, Discussions, Comments) to target the profile owner's parameters.
  - Add missing translation keys to `en.json` and `zh-CN.json` (e.g. `"backToProfile"`).
- **Verification:**
  - Check that a sticky Header appears on all pages except `/entry/*`.
  - Validate that resizing the screen to mobile collapses the navigation and displays a hamburger button that opens the drawer.
  - Confirm the word "首页" is removed from the top of the Home page stream.
  - Verify that profile pages show profile features, while settings pages show settings configuration menus.
  - Confirm that visiting another user's profile sidebar does not expose settings buttons or private mailbox links.

### Cycle 2: Sidebar Widgets, Tooltip Alignment & Translations (QA #2, #6)

- **Goal:** Update the tooltip popup alignment to the center, restore the Online Users Wall widget to all main sidebars, and configure global categories navigation.
- **Tasks:**
  - Modify `src/lib/components/atoms/Tooltip.svelte` popover classes:
    - Replace `right-0` with center alignment styles (`left-1/2 -translate-x-1/2`).
  - Modify the sidebar snippet in `src/routes/+page.svelte` (Home), `src/routes/categories/+page.svelte`, `src/routes/category/[categorySlug]/+page.svelte`, and `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte` to import and render `<ActiveUsersWall {t} />` at the bottom of the sidebar list.
  - Implement a `CategoryListWidget.svelte` component displaying categories navigation. Add it to the sidebar of all Forum routes.
  - Populate the translation file with `"forum"` block strings to prevent default English fallbacks (views, replies, PIN) in `DiscussionRow.svelte`.
- **Verification:**
  - Click notification, messages, and bookmarks icons to verify the popover tooltip is centered.
  - Confirm that the Active Users Wall and Category List widgets are visible on Home, Category, and Discussion pages.

### Cycle 3: Editor Usability & Moderator Sticky Toggle (QA #4, #5, #14)

- **Goal:** Correct the create discussion page layout width, fix state initialization issues when drafts are loaded across composers, and implement sticky/unsticky actions.
- **Tasks:**
  - Replace `<SingleColumnLayout>` in `src/routes/post/discussion/+page.svelte` with a full-width container (or `<DualColumnLayout>` with no sidebar snippet) to prevent the editor from being squished.
  - Update `src/lib/components/organisms/LexicalEditor.svelte` so that it immediately emits an initial `onContentChange` event with the `initialContent` JSON upon initialization. This synchronizes the parent page state variable (e.g. `contentJson`, `replyContent`, `editorContent`) immediately, enabling submit/publish buttons without requiring manual typing.
  - Apply this draft synchronization check across all four editors: Discussion Creator (`/post/discussion`), Message Composer (`/messages/new`), Activity square composer (`/activity`), and Reply Composer (`/discussion/*`).
  - Implement Sticky/Unsticky toggle actions:
    - In `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte`, add a "置顶" (Sticky) / "取消置顶" (Unsticky) action link on the OP metadata area.
    - Update the details page loader (`+page.server.ts`) to compute and return category `canDelete` permissions to the client-side Svelte page.
    - Render this toggle link only if the user has category-level `canDelete` permission.
    - Implement `togglePin` SvelteKit action inside `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts` to flip the discussion's `isPinned` column in the SQLite DB, validating permissions on the server.
- **Verification:**
  - Go to `/post/discussion`. Confirm the layout occupies a wide column (up to 960px).
  - Create a discussion draft, navigate away, and return. Verify that the draft loads and the "Publish" button is enabled immediately.
  - Log in as a user with category-level `canDelete` permission. Confirm the sticky toggle button is visible next to the OP, and clicking it updates the pin state immediately. Non-authorized users should not see the link.

### Cycle 4: Permissions Fallback, Mistranslations & Mentions (QA #8, #9, #13)

- **Goal:** Seed the guest role, secure category permissions for unlogged guests, filter list query records by category read access, correct translations, and support user mentions.
- **Tasks:**
  - Seed `'guest'` user group in `src/lib/server/db/seed.ts` (with empty permissions JSON `{}`).
  - Update `groupSlug` assignment in all permission loaders (categories, category details, discussion details) to fallback to `'guest'` when `user` is null:
    - `const groupSlug = user?.groupSlug || 'guest';`
  - Implement a centralized category permissions helper `resolvePermissions(db, categorySlug, user)` to avoid code duplication. Enforce default fallback permissions:
    - **Guest:** `canRead = true` (public categories), others `false`.
    - **Member:** `canRead = true`, `canCreate = true`, others `false`.
    - **Admin/Moderator:** CRUD `true`.
  - Secure Listings (Fix Category Permission Leaks): Update list querying DAOs (`getDiscussionsList`, `getDiscussionsCount`, and `getUserComments`) to join `categoryPermissions` and filter out entries belonging to categories that the current user/guest does not have read access to.
  - Rename the translation key from `"dynamics"` to `"activities"` in `src/lib/i18n/en.json` and `src/lib/i18n/zh-CN.json`. Refactor all occurrences of `profileT.dynamics` to `profileT.activities` in all Svelte route templates.
  - Create a centralized server-side utility helper `resolveMentions(contentJsons: string[], db)` in `$lib/server/utils/mentions.ts`.
  - Update SvelteKit load handlers for discussions, replies, Activity Square (`/activity`), PM details (`/messages/[id]`), and comments lists (`/profile/comments/*`) to scan loaded content JSONs for `@username` patterns, fetch matched user records using the utility helper, and return a `mentionedUsers` dictionary.
  - Update `LexicalRendererProps` inside `src/lib/components/molecules/LexicalRenderer.svelte` to accept the `mentionedUsers` map as a prop. Parse text nodes: when a text node matches `@username`, render it as an inline Chip displaying the user's `displayName` from the map, falling back to plain text if the user does not exist in the map.
- **Verification:**
  - Log out and access a restricted category (where `member` can read but guest cannot). Verify a `403 Forbidden` error is returned.
  - Confirm that homepage and profile page lists do not display discussions or comments from restricted categories when accessed by unauthorized users.
  - Verify that the profile sidebar lists "Activities" instead of "Dynamics" in English (confirming the refactored Svelte templates and the new key `profileT.activities`).
  - Create a post containing `@username`. Confirm that the username is rendered as a Chip showing the user's nickname.

### Cycle 5: Lexical Hyperlinks, Spoilers & Marker Highlights (QA #10, #11)

- **Goal:** Add Lexical hyperlink auto-generation, text selection links, marker highlights, and the hover-to-reveal Spoiler text style.
- **Tasks:**
  - Integrate an AutoLinkPlugin in Svelte-Lexical to convert typed URLs (e.g. `https://google.com`) directly into clickable link nodes. Ensure custom URL regex matchers are defined and passed as props to the plugin.
  - Ensure the toolbar's `InsertLink` button correctly prompts and overlays link attributes for selected text.
  - Implement a "Marker Highlight" rich text option in both `LexicalEditor.svelte` (toolbar button) and `LexicalRenderer.svelte` (style mapping on highlight bit).
  - Implement a "Spoiler" formatting option:
    - Add a "Spoiler" button to `LexicalEditor.svelte` toolbar.
    - Map Lexical's standard Highlight format (bit 128) to a custom `.spoiler-text` CSS class inside the theme configs of both `LexicalEditor.svelte` and `LexicalRenderer.svelte`.
    - Configure global CSS styling rules for `.spoiler-text`: they should have matching background and text colors (or `bg-current text-current`) by default, revealing the text with `hover:bg-transparent hover:text-base-content` transitions on hover. Use `!important` hover styles to override any conflicting inline style rules.
- **Verification:**
  - Type `https://google.com` in the editor. Verify it converts to a link on render.
  - Select text and apply a link using the toolbar. Verify the link functions.
  - Select text, apply the Spoiler style, and publish. Confirm the text appears blocked out and is revealed only when the cursor hovers over it.

### Cycle 6: E2E Integration Testing & Verification

- **Goal:** Ensure all 14 issues are fully resolved without introducing regressions.
- **Tasks:**
  - Execute end-to-end integration tests on login, registration, posting, messaging, notifications, and mentions. E2E tests are performed via manual walkthroughs, or by setting up Vitest/Playwright dependencies in `package.json`.
  - Verify that all Svelte component props consume named callback types from `src/lib/types/handlers.ts` (e.g. `VoidHandler`) instead of inline type signatures to satisfy strict linter rules.
  - Run `bun run lint` and `bun run check` to verify zero TypeScript and ESLint warnings exist across all files.

---

## 4. Requirements Alignment Matrix

| Issue ID  | QA Bug Target                | Target File(s)                                                 | Development Cycle | Verification Criteria                                                                           |
| :-------- | :--------------------------- | :------------------------------------------------------------- | :---------------- | :---------------------------------------------------------------------------------------------- |
| **QA-01** | Header Component Missing     | `src/lib/components/organisms/Header.svelte`, layout files     | Cycle 1           | Header is visible on all non-entry views, containing logo and navigation links                  |
| **QA-02** | Tooltip Alignment            | `src/lib/components/atoms/Tooltip.svelte`                      | Cycle 2           | Popover tooltips are centered under icons (`left-1/2 -translate-x-1/2`)                         |
| **QA-03** | Mobile Drawer Inaccessible   | `Header.svelte`, `DualColumnLayout.svelte`                     | Cycle 1           | Hamburger button toggles sidebar drawer on mobile viewport width (< 768px)                      |
| **QA-04** | Create Discussion squished   | `src/routes/post/discussion/+page.svelte`                      | Cycle 3           | Content wraps in wide container rather than `max-w-md` SingleColumnLayout                       |
| **QA-05** | New Message Draft block      | `src/routes/messages/new/+page.svelte`, `LexicalEditor.svelte` | Cycle 3           | Initializing with draft updates content state, enabling the Send button                         |
| **QA-06** | Online Users Wall missing    | Svelte page layouts/sidebars                                   | Cycle 2           | `ActiveUsersWall` renders at the bottom of the sidebar on Home and other forum pages            |
| **QA-07** | Redundant "首页" Title       | `src/routes/+page.svelte`                                      | Cycle 1           | Redundant Home page `<h1>` is removed, keeping stream start clean                               |
| **QA-08** | Mention display name Chip    | `LexicalRenderer.svelte`, server load handlers                 | Cycle 4           | `@username` resolves to user's display name and renders as a Chip                               |
| **QA-09** | Mistranslation of "动态"     | `src/lib/i18n/en.json`, `zh-CN.json`, Svelte templates         | Cycle 4           | Translation key renamed to `"activities"`; Svelte templates refactored to `profileT.activities` |
| **QA-10** | Hyperlink Auto-linking       | `LexicalEditor.svelte`                                         | Cycle 5           | Text URLs automatically parse into links; highlighted link creation works                       |
| **QA-11** | Spoiler Inline Text Style    | `LexicalEditor.svelte`, `LexicalRenderer.svelte`, CSS          | Cycle 5           | Spoiler text has matching background/foreground; reveals on cursor hover                        |
| **QA-12** | Monolithic Profile Sidebar   | Profile Svelte routes, menu lists                              | Cycle 1           | Settings pages render settings-only links; profile pages render profile-only links              |
| **QA-13** | Invincible Guest Permissions | Permission loaders, `seed.ts`                                  | Cycle 4           | Unlogged guests are default-fallback to `'guest'` group; blocked on restricted sections         |
| **QA-14** | OP Sticky / Unsticky link    | `+page.svelte`, `+page.server.ts`                              | Cycle 3           | Toggle pin button renders on OP only for users with category-level `canDelete` permissions      |

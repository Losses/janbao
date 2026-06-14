# DV02-Plan: Discussion Edit/Delete & Activity Inline Comment

## 1. Executive Summary

The discussion detail page currently only has PIN/UNPIN action buttons. Edit and delete functionality - for both the original post (OP) and replies - is entirely missing from the frontend UI, routes, and server-side endpoints. Additionally, the comment interaction on the Activity page has issues: the comment entry should be a "Comment" text link that expands a rich-text editor below the activity, rather than the current comment icon + plain-text input. This document plans the complete implementation of these features.

---

## 2. Requirements

### 2.1 Action Button Visibility

| Button     | OP                                   | Reply                                |
| ---------- | ------------------------------------ | ------------------------------------ |
| **Pin**    | `canDelete` permission               | ❌ Not shown                         |
| **Edit**   | `canUpdate` permission **or** author | `canUpdate` permission **or** author |
| **Delete** | `canDelete` permission               | `canDelete` permission               |

- `canUpdate` and `canDelete` come from `resolvePermissions(db, categorySlug, user)`.
- "Author" check: `user.id === reply.authorId` / `user.id === discussion.authorId`.
- Logged-out users see no action buttons.

### 2.2 Edit Behavior

**Reply - Inline Edit**

1. Click Edit → the reply's content area becomes a `LexicalEditor`, pre-loaded with `contentJson`.
2. Below the editor, "Cancel" and "Save Comment" buttons appear.
3. Save → form action `?/editReply`, on success refresh page data (`update()`).
4. Cancel → restore the rendered view, discard edits.
5. Only one reply can be in edit mode at a time.

**OP - Navigate to Edit Page**

1. Click Edit → navigate to `/post/editDiscussion/[discussionId]`.
2. The edit page layout is identical to the new-post page (`/post/discussion`), pre-loaded with: title, categorySlug, themeName, contentJson.
3. Submit → form action `?/update`, on success `redirect` back to the discussion detail page.

### 2.3 Delete Behavior

1. Click Delete → show `ConfirmationModal` (reuse the existing pattern from `ActivityRow`).
2. Confirm → form action `?/deleteDiscussion` (OP) or `?/deleteReply` (reply).
3. Soft delete: set `deletedAt = new Date()`.
4. After deleting OP → `redirect` to homepage `/`.
5. After deleting reply → `update()` to refresh current page data.

### 2.4 Quick Reply (Reply Button + @mention Auto-insert)

Each reply (not the OP) should have a "Reply" button for quickly referencing that reply's author:

1. **Visibility**: `canCreate` permission (i.e., logged-in users with post/reply permissions).
2. **Click behavior**:
   - Auto-insert `@username ` (the replied-to author's username) in the bottom reply editor (LexicalEditor).
   - Smooth-scroll to the bottom reply editor area and focus the editor.
3. **Technical implementation**:
   - LexicalEditor currently does not expose a programmatic insert API (no `bind:this` method, no `insertText`).
   - Add a new `insertText(text: string)` method to LexicalEditor, exposed to parent components via the component instance.
   - Parent component gets the editor instance via `bind:this` and calls `editor.insertText('@username ')`.
4. **Mention rendering**: `@username` is written as plain text in the editor → server-side `resolveMentions()` parses it → `LexicalRenderer` renders it as a chip. This pipeline is already fully implemented and requires no changes.

### 2.5 Activity Row Layout Fix & Inline Comment

The layout of each activity row on the Activity page needs correction, along with adding a "Comment" link and inline editor.

#### Layout Correction

**Current layout (incorrect)** - `ActivityRow.svelte`:

- Row 1: Username + timestamp + recipient (all crammed on one line)
- Row 2: Content
- Row 3: Comment icon (`mdiCommentOutline`) + delete icon

**Target layout (correct)**:

- Row 1: Username (→ recipient arrow + recipient name)
- Row 2: Content
- Row 3: Timestamp + "Comment" text link + delete button

#### "Comment" Link Behavior

1. **Visibility**:
   - Only **top-level activities** (`parentActivityId === null`) show the "Comment" link. `ActivityRow` needs a new `isTopLevel` prop (or determine via `parentActivityId === null`) to distinguish.
   - **Child replies** do not show the "Comment" link.
   - Only visible to logged-in users.

2. **Click behavior**:
   - Below the activity's third row (timestamp + comment link row), expand a `LexicalEditor` (rich text) + submit button.
   - The existing comment list (child replies) displays normally below the editor.
   - Clicking "Comment" again collapses the entire area (editor + comment list).

3. **Submit behavior**:
   - Call the existing `POST /api/activities/comments` endpoint (`parentActivityId` + `contentJson`).
   - On success: clear editor, `commentCount + 1`, refresh comment list.
   - The backend endpoint is fully implemented and requires no changes.

4. **Remove**: Delete the original plain-text `<input>` comment input, replacing it with the LexicalEditor.

### 2.6 Profile Page Directed Activity Editor

The Profile page (`/profile/[userId]/[userSlug]`) should have a rich-text editor between the user info and the activity list for sending directed activities.

#### Current Issue

- The editor only shows when `user && !isOwner` (viewing someone else's profile).
- When viewing your own profile, the editor disappears, making it impossible to send directed activities.
- Original requirement: **The Activity feed (`/activity`) must not allow sending directed activities directly**; directed activity sending **only happens on the Profile page**.

#### Target Behavior

1. **Editor visibility**: Any logged-in user (`user`), regardless of viewing own or others' profile.
2. **Others' profile**: Send directed activity (`recipientId = targetUser.id`).
3. **Own profile**: Send normal activity (`recipientId = null`).
4. **Activity list**: Show activities **received by** + **sent by** this user (`authorId = userId OR recipientId = userId`); server-side query is already correctly implemented.

#### Changes Required

- `+page.svelte`: Change editor visibility condition from `user && !isOwner` to `user`.
- `submitDirectedActivity()`: When `isOwner`, don't pass `recipientId` (send normal activity).
- Server-side query logic requires no changes (already correct).

---

## 3. Development Cycles

### Cycle 1: Server - Data Plumbing & Form Actions

- **Goal**: Complete permission data passing, create the edit page route load function, implement all edit/delete form actions.

**Tasks**:

1. **Discussion `+page.server.ts` load function** - add to return value:
   - Add `canUpdate: boolean`, `canCreate: boolean` (from `resolvePermissions`).
   - Add `user` object (current logged-in user, with `id`, `groupSlug`; `null` if not logged in).

2. **Create `src/routes/post/editDiscussion/[discussionId]/+page.server.ts`** - load + update action:
   - Load: verify user is logged in, query discussion + OP contentJson, verify `canUpdate` or author, query writable category list, return `{ discussion, opContentJson, categories, draftContent }`.
   - `?/update` action: verify login, get `title`, `categorySlug`, `themeName`, `contentJson`, verify permissions, UPDATE discussions + OP reply, redirect back to discussion detail page.

3. **Discussion `+page.server.ts` new actions**:
   - `?/editReply`: verify login → get `replyId`, `contentJson` → check permissions (`canUpdate` or author) → UPDATE reply.
   - `?/deleteReply`: verify login → get `replyId` → check permissions (`canDelete`) → soft delete reply + `commentCount - 1`.
   - `?/deleteDiscussion`: verify login → check permissions (`canDelete`) → soft delete discussion → redirect `/`.

**Verification**:

- `bun run check` passes with no type errors.
- `bun run lint` passes.

---

### Cycle 2: Frontend - Discussion Edit/Delete/Quick Reply

- **Goal**: Complete action button group for OP and replies, inline editing, OP edit page, Quick Reply.

**Tasks**:

1. **LexicalEditor programmatic insert API** - modify `LexicalEditor.svelte`:
   - Add `insertText(text: string)` method, exposed via `bind:this`.
   - Implement using `editorInstance.update()` + `$createTextNode()`.

2. **OP action button group** - modify discussion `+page.svelte`:
   - Pin (`canDelete`), Edit (`canUpdate` or author, `<a href="/post/editDiscussion/...">`), Delete (`canDelete`, ConfirmationModal).

3. **Create `src/routes/post/editDiscussion/[discussionId]/+page.svelte`**:
   - Copy the new-post page structure, pre-load title / categorySlug / themeName / contentJson, action points to `?/update`.

4. **Reply action buttons + inline edit** - discussion `+page.svelte` in `{#each repliesList}`:
   - Reply (`canCreate`, calls `quickReply(username)`), Edit (`canUpdate` or author, inline LexicalEditor), Delete (`canDelete`, ConfirmationModal).
   - Reference `PrivateMessageWindow.svelte` inline edit pattern.

5. **Quick Reply** - discussion `+page.svelte`:
   - `bind:this` to get the bottom editor instance.
   - `quickReply(username)` → `editor.insertText('@username ')` → `scrollIntoView` bottom editor.

6. **i18n** - `en.json` / `zh-CN.json` discussion block:
   - `editDiscussion` / `editReply` / `saveReply` / `deleteDiscussion` / `deleteReply` / `deleteDiscussionConfirm` / `deleteReplyConfirm` / `quickReply`.

**Verification**:

- Admin sees Pin + Edit + Delete on OP; sees Reply + Edit + Delete on replies.
- Author sees Edit on OP; sees Reply + Edit on replies.
- Click reply Edit → inline editor + Cancel/Save.
- Click OP Edit → navigate to edit page, data pre-loaded.
- Click Reply → bottom editor inserts `@username `, scrolls into view.
- Delete → ConfirmationModal → soft delete.
- `bun run lint` + `bun run check` pass.

---

### Cycle 3: Activity Row Layout, Inline Comment & Profile Editor

- **Goal**: Fix ActivityRow layout, inline LexicalEditor comments, correct Profile page editor visibility condition.

**Tasks**:

1. **ActivityRow layout correction** - modify `ActivityRow.svelte`:
   - Row 1: Username (→ recipient), remove `DateComponent`.
   - Row 2: Content.
   - Row 3: `DateComponent` + "Comment" text link + delete button.
   - Child replies get the same adjustment, but without the "Comment" link.

2. **Distinguish top-level / child replies**:
   - Add `isTopLevel: boolean` prop to ActivityRow (default `true`).
   - "Comment" link only shows when `isTopLevel && currentUserId`.

3. **Inline LexicalEditor** - replace plain-text `<input>`:
   - Expanded: LexicalEditor + submit button → comment list.
   - Submit calls existing `POST /api/activities/comments`, no backend changes needed.

4. **Profile page editor** - modify `src/routes/profile/[userId]/[userSlug]/+page.svelte`:
   - Change visibility condition from `user && !isOwner` to `user`.
   - `submitDirectedActivity()`: when `isOwner`, don't pass `recipientId` (normal activity); when not owner, pass `recipientId`.
   - Adjust prompt text based on `isOwner`.

5. **i18n** - `en.json` / `zh-CN.json` activity / profile block (if new keys are added).

**Verification**:

- Top-level activity three-row layout: username → content → timestamp + comment link + delete.
- Child reply three-row layout: username → content → timestamp + delete (no comment link).
- Click "Comment" → LexicalEditor + comment list expand.
- Own Profile → editor visible, sends normal activity.
- Others' Profile → editor visible, sends directed activity.
- `bun run lint` + `bun run check` pass.

---

## 4. Files Touched

| File                                                                        | Change                                                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.server.ts` | Add `canUpdate`, `user`, `canCreate` to load return; add `editReply`, `deleteReply`, `deleteDiscussion` actions                   |
| `src/routes/discussion/[discussionId]/[slug]/[[page=page]]/+page.svelte`    | OP action buttons; reply action buttons (Reply / Edit / Delete); inline edit; Quick Reply; ConfirmationModal                      |
| `src/routes/post/editDiscussion/[discussionId]/+page.server.ts`             | **New** - load + update action                                                                                                    |
| `src/routes/post/editDiscussion/[discussionId]/+page.svelte`                | **New** - edit page (reuses new-post page structure)                                                                              |
| `src/lib/components/organisms/LexicalEditor.svelte`                         | Add `insertText()` method, exposed to parent via `bind:this`                                                                      |
| `src/lib/components/organisms/ActivityRow.svelte`                           | Layout fix (timestamp moved to row 3); add `isTopLevel` prop; "Comment" text link; inline LexicalEditor replaces plain-text input |
| `src/routes/profile/[userId]/[userSlug]/+page.svelte`                       | Change editor visibility from `user && !isOwner` to `user`; submit logic distinguishes isOwner (whether to pass recipientId)      |
| `src/lib/i18n/en.json`                                                      | Add discussion + activity related keys                                                                                            |
| `src/lib/i18n/zh-CN.json`                                                   | Add discussion + activity related keys                                                                                            |

---

## 5. Existing Patterns to Reuse

| Pattern                                | Source File                               | Usage                                                                                   |
| -------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| ConfirmationModal                      | `ActivityRow.svelte`                      | OP delete, reply delete confirmation                                                    |
| Inline edit (editor replaces renderer) | `PrivateMessageWindow.svelte`             | Reply inline edit                                                                       |
| New-post page layout + form structure  | `src/routes/post/discussion/+page.svelte` | Edit page template                                                                      |
| `resolvePermissions`                   | `src/lib/server/constants.ts`             | Permission checks                                                                       |
| `enhance()` form actions               | Multiple existing locations               | Edit/delete submissions                                                                 |
| Mention rendering pipeline             | `resolveMentions()` + `LexicalRenderer`   | `@username` plain text → chip rendering (already complete, Quick Reply reuses directly) |
| Activity comment submission            | `POST /api/activities/comments`           | Already implemented, ActivityRow inline editor reuses directly                          |

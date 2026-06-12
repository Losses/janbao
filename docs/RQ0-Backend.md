# RQ0-Backend: Backend Architecture Document

## 1. System Architecture Overview

The Janbao Forum System backend is designed to run on **Cloudflare Pages / Workers**, utilizing SvelteKit's server-side runtime. The data store is **Cloudflare D1** (a serverless SQL database powered by SQLite), accessed through the **Drizzle ORM** type-safe query builder.

```
                  +--------------------------------+
                  |        Cloudflare Pages        |
                  |     (SvelteKit SSR Runtime)    |
                  +---------------+----------------+
                                  |
            +---------------------+---------------------+
            |                                           |
            v                                           v
+-----------+-----------+                    +----------+-----------+
|     Cloudflare D1     |                    |      pCloud API      |
|  (Serverless SQLite)  |                    |   (External Storage) |
+-----------------------+                    +----------------------+
```

---

## 2. Database Schema Design (Drizzle ORM & SQLite)

The schema defines the relational layout for users, categories, discussions, messages, activities, and notification states, utilizing indexing to optimize SQLite execution performance.

### 2.1 Schema Definition Code (`schema.ts`)
The schema definition maps directly to SQLite data types:

```typescript
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- User & Group Schemas ---
export const userGroups = sqliteTable('user_groups', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  // JSON array containing CRUD flags: { discussions: 'crud', categories: 'crud', messages: 'r' }
  permissionsJson: text('permissions_json').notNull().default('{}'), 
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  avatarFileId: text('avatar_file_id'), // Referencing pCloud fileId
  groupSlug: text('group_slug').notNull().references(() => userGroups.slug),
  signupTime: integer('signup_time', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  lastActiveTime: integer('last_active_time', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  showEmail: integer('show_email', { mode: 'boolean' }).notNull().default(false),
  languagePreference: text('language_preference').notNull().default('en'),
  isStealth: integer('is_stealth', { mode: 'boolean' }).notNull().default(false),
  rssToken: text('rss_token').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  viewCount: integer('view_count').notNull().default(0), // Profile views count
});

// --- Forum Schema ---
export const categories = sqliteTable('categories', {
  slug: text('slug').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  priority: integer('priority').notNull().default(1), // Determines default category on create post
  displayOrder: integer('display_order').notNull().default(1),
  themeName: text('theme_name'), // Configurable DaisyUI theme
});

export const categoryPermissions = sqliteTable('category_permissions', {
  categorySlug: text('category_slug').notNull().references(() => categories.slug, { onDelete: 'cascade' }),
  groupSlug: text('group_slug').notNull().references(() => userGroups.slug, { onDelete: 'cascade' }),
  canCreate: integer('can_create', { mode: 'boolean' }).notNull().default(true),
  canRead: integer('can_read', { mode: 'boolean' }).notNull().default(true),
  canUpdate: integer('can_update', { mode: 'boolean' }).notNull().default(true),
  canDelete: integer('can_delete', { mode: 'boolean' }).notNull().default(true),
}, (table) => ({
  pk: primaryKey({ columns: [table.categorySlug, table.groupSlug] }),
}));

export const discussions = sqliteTable('discussions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  categorySlug: text('category_slug').notNull().references(() => categories.slug),
  authorId: text('author_id').notNull().references(() => users.id),
  viewCount: integer('view_count').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  themeName: text('theme_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }), // Soft delete support
}, (table) => ({
  categoryIdx: index('discussions_category_idx').on(table.categorySlug),
  authorIdx: index('discussions_author_idx').on(table.authorId),
  createdIdx: index('discussions_created_idx').on(table.createdAt),
}));

export const replies = sqliteTable('replies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  discussionId: text('discussion_id').notNull().references(() => discussions.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => users.id),
  contentJson: text('content_json').notNull(), // Lexical JSON State
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }), // Soft delete support
}, (table) => ({
  discussionIdx: index('replies_discussion_idx').on(table.discussionId),
  authorIdx: index('replies_author_idx').on(table.authorId),
  createdIdx: index('replies_created_idx').on(table.createdAt),
}));

// --- User Context States ---
export const bookmarks = sqliteTable('bookmarks', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  discussionId: text('discussion_id').notNull().references(() => discussions.id, { onDelete: 'cascade' }),
  bookmarkedAt: integer('bookmarked_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.discussionId] }),
  discussionIdx: index('bookmarks_discussion_idx').on(table.discussionId),
  userBookmarkedIdx: index('bookmarks_user_bookmarked_idx').on(table.userId, table.bookmarkedAt), // Optimizes bookmarks sidebar tooltip
}));

export const discussionReads = sqliteTable('discussion_reads', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  discussionId: text('discussion_id').notNull().references(() => discussions.id, { onDelete: 'cascade' }),
  lastReadAt: integer('last_read_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  lastReadPage: integer('last_read_page').notNull().default(1),
  lastReadReplyId: text('last_read_reply_id'),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.discussionId] }),
}));

export const drafts = sqliteTable('drafts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(), // 'discussion', 'reply', 'message', 'activity'
  contextId: text('context_id'), // categorySlug, discussionId, conversationId
  contentJson: text('content_json').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  authorIdx: index('drafts_author_idx').on(table.authorId),
}));

// --- Private Messaging ---
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
});

export const conversationParticipants = sqliteTable('conversation_participants', {
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  pk: primaryKey({ columns: [table.conversationId, table.userId] }),
  userIdIdx: index('conversation_participants_user_idx').on(table.userId), // Optimizes user conversation query
}));

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => users.id),
  contentJson: text('content_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`), // PMs can be edited
  // PM messages cannot be soft-deleted by users, hence deletedAt is removed
}, (table) => ({
  conversationIdx: index('messages_conversation_idx').on(table.conversationId),
  authorIdx: index('messages_author_idx').on(table.authorId),
}));

export const conversationReads = sqliteTable('conversation_reads', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  lastReadAt: integer('last_read_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.conversationId] }),
}));

// --- Activities (Microblog) ---
export const activities = sqliteTable('activities', {
  id: text('id').primaryKey(), // Using deterministic welcome keys (e.g. welcome-YYYY-MM-DD) or UUIDs
  authorId: text('author_id').notNull().references(() => users.id),
  recipientId: text('recipient_id').references(() => users.id), // For A -> B dynamic target
  contentJson: text('content_json').notNull(),
  parentActivityId: text('parent_activity_id'), // Single level comment thread structure
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }), // Soft delete support
}, (table) => ({
  authorIdx: index('activities_author_idx').on(table.authorId),
  parentIdx: index('activities_parent_idx').on(table.parentActivityId),
  recipientIdx: index('activities_recipient_idx').on(table.recipientId), // Optimizes profile activity query
  createdIdx: index('activities_created_idx').on(table.createdAt),
}));

// --- Notification Engine ---
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'mention', 'reply', 'message', 'profile_comment', 'discussion_comment'
  sourceUserId: text('source_user_id').references(() => users.id, { onDelete: 'cascade' }),
  discussionId: text('discussion_id'),
  replyId: text('reply_id'),
  messageId: text('message_id'),
  activityId: text('activity_id'),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  userReadIdx: index('notifications_user_read_idx').on(table.userId, table.isRead),
  userCreatedIdx: index('notifications_user_created_idx').on(table.userId, table.createdAt), // Optimizes notifications sidebar tooltip
}));

export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  profileComment: integer('profile_comment', { mode: 'boolean' }).notNull().default(true),
  discussionReply: integer('discussion_reply', { mode: 'boolean' }).notNull().default(true),
  privateMessage: integer('private_message', { mode: 'boolean' }).notNull().default(true),
  discussionComment: integer('discussion_comment', { mode: 'boolean' }).notNull().default(true),
  participatedComment: integer('participated_comment', { mode: 'boolean' }).notNull().default(true),
  mention: integer('mention', { mode: 'boolean' }).notNull().default(true),
  bookmarkedDiscussionComment: integer('bookmarked_discussion_comment', { mode: 'boolean' }).notNull().default(true),
});

// --- Upload Attachment Registry (Security Shield) ---
export const attachments = sqliteTable('attachments', {
  fileId: text('file_id').primaryKey(),
  uploaderId: text('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  uploaderIdx: index('attachments_uploader_idx').on(table.uploaderId),
}));

// --- Invitations Registry (System Register Core) ---
export const invitations = sqliteTable('invitations', {
  code: text('code').primaryKey(),
  creatorId: text('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  usedById: text('used_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  // The status is resolved dynamically in queries; SQLite schema uses this to store state default
  status: text('status').notNull().default('unused'), // 'unused', 'used', 'expired'
}, (table) => ({
  creatorIdx: index('invitations_creator_idx').on(table.creatorId),
}));
```

---

## 3. Session Management & Authentication

Instead of utilizing heavy framework bindings, a custom JWT mechanism is implemented via SvelteKit hooks.

### 3.1 Session Verification Flow
- **Token Type:** JSON Web Token (JWT) signed using a secret key defined in environment variables (`JWT_SECRET`) utilizing `HMAC SHA-256`.
- **Token Cookie Injection:** Stored in a secure, `HttpOnly`, `SameSite=Strict`, `Secure` cookie named `session_token`.
- **Remember Me Logic:** If "Remember Me" is activated on sign-in, the cookie parameter is configured with `maxAge: 2592000` (30 days). Otherwise, it is a session cookie (omitting `maxAge`).
- **JWT Content Structure:**
  ```json
  {
    "sub": "user-uuid-value",
    "username": "janedoe",
    "role": "moderator", // Resolved dynamically from users.groupSlug mapping
    "exp": 1718131200
  }
  ```
- **JWT Interceptor (`src/hooks.server.ts`):**
  On every server request:
  1. Retrieve `session_token` cookie.
  2. If present, verify signature and expiration.
  3. Resolve user details from the database.
     - **Security Redaction:** The user object is queried from the database, and the sensitive `passwordHash` field is **explicitly deleted/redacted** from the object before assigning it to SvelteKit's `event.locals.user` to prevent leakage.
  4. If invalid or expired, clear the cookie and set `event.locals.user = null`.

### 3.2 Authorization Gates & Mutations Controls
Routes and server actions check the active session:
- **Admin Section Protection:** Verifies if `event.locals.user.role === 'admin'`. If not, throws a 403 Forbidden error.
- **Category CRUD Permissions:** Queries the `categoryPermissions` table matching the user's `groupSlug` to check authorization flag states before servicing read or write mutations.
- **Validation Rules on Mutations:**
  - **Password Strength:** Password length validation check requires `password.length >= 5` on both register and password update actions. Returns `400 Bad Request` if fails.
  - **Account Username Update:** Username field updates are rejected on `/profile/edit` action unless the active user has an admin role.
  - **Reply Mutations:** Updates to reply strings are allowed only if `reply.authorId === currentUserId` or the user group has category management permissions. Deletions are allowed only if the user group has category management permissions. All queries filter out deleted rows using Drizzle `isNull(replies.deletedAt)`.
  - **Activity Comment Deletions:** Allowed only if the user is the comment author, the target profile recipient, the original activity author, or an admin.

---

## 4. pCloud File Upload & Reverse Proxy API

To circumvent domain-level network blocks, SvelteKit functions as an inline reverse proxy to pCloud services.

### 4.1 Proxy Route: Image Upload (`/upload/+server.ts`)
1. Receives upload payload (e.g. `multipart/form-data`).
2. **File Size Limit Enforced:** Max 1MB for user avatars; max 5MB for standard discussion/activity images.
3. **Mime-Type Whitelist Filtering:** Restricts uploads strictly to web-safe image formats (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`, `image/bmp`).
   - **Stored XSS Mitigation:** The MIME-type `image/svg+xml` is explicitly excluded from the upload whitelist because SVGs can execute embedded script blocks.
4. Forwards content to pCloud API `https://api.pcloud.com/uploadfile?auth=${PCLOUD_TOKEN}&folderid=${PCLOUD_FOLDER_ID}`.
5. Receives JSON output from pCloud containing the generated `fileid`.
6. Logs the `fileid` and the `uploaderId` in the `attachments` table.
7. Returns link to client: `https://${url.host}/img/${fileid}`.

### 4.2 Proxy Route: Image Retrieval (`/img/[fileid]/+server.ts`)
1. Receives request for `/img/<fileid>`.
2. **Attachment Validation check:** Queries `attachments` to verify that `fileid` exists. If not found, returns `404 Not Found` (protecting private pCloud files).
3. Requests file download link from pCloud `https://api.pcloud.com/getfilelink?auth=${PCLOUD_TOKEN}&fileid=${fileid}`.
4. Executes internal sub-fetch to retrieval URL `https://${host}${path}`.
5. Pipe the image stream directly back to the client response, returning an identical Content-Type header.
6. **Security Headers Added:** Injects `X-Content-Type-Options: nosniff`. If the mime-type is not a verified safe image type, injects `Content-Disposition: attachment; filename="file.bin"` to prevent browser script execution.
7. **CDN Optimization:** Injects header `Cache-Control: public, max-age=31536000` (1 year). Cloudflare CDN edges cache this response.

---

## 5. Automation & Core Logical Engines

### 5.1 Vanilla Forums Slugification Algorithm (TypeScript Port)
The exact slugification method cloned from the legacy Vanilla codebase is implemented as follows:

```typescript
export function generateSlug(text: string): string {
  // 1. strip tags & html entity decode
  let cleaned = text.replace(/<[^>]*>?/gm, '');
  
  // Minimal transliteration mapping
  const urlTranslations: Record<string, string> = {
    "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
    "А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D", "Е": "E", "Ё": "Yo", "Ж": "Zh",
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "zh"
  };

  cleaned = cleaned.split('').map(char => urlTranslations[char] || char).join('');
  
  // 2. Strip single quotes
  cleaned = cleaned.replace(/[']/g, '');

  // 3. Replace all non-alphanumeric/spaces with hyphens
  cleaned = cleaned.replace(/[\s\W_]+/g, '-');

  // 4. Squeeze multiple hyphens, convert to lowercase, trim hyphens
  cleaned = cleaned.replace(/-+/g, '-').toLowerCase();
  
  const result = encodeURIComponent(cleaned.replace(/^-+|-+$/g, ''));
  // Unicode preservation fallback to ensure routing does not break on purely Chinese/Non-Latin titles
  return result || 'discussion';
}
```

### 5.2 Active Users Wall tracking
- **Update Rule:** On authenticated page transitions, the server checks if the user's `lastActiveTime` is older than 60 seconds. If so, a background update query updates `lastActiveTime = now` in the database. This throttles write queries to D1.
- **Fetch Rule:** Online list filters out users with `isStealth = true` or `lastActiveTime` older than 10 minutes.

### 5.3 Daily Welcome Post Generation (Trigger on Layout Access)
Instead of running on every authenticated API hook, the check-on-access runs only during layouts load queries on home (`/`) or activity square (`/activity`) pages:
1. When loading public indexes, SvelteKit resolves the boundaries of "yesterday" using the configured `FORUM_TIMEZONE` (defaulting to UTC if not set).
2. The server checks the database to verify if a welcome post for the current day exists in the `activities` table.
3. If not found:
   - Queries users created during the yesterday timezone period.
   - If count > 0:
     - Constructs a structured Lexical JSON state. This JSON state generates text nodes with nested link nodes pointing to each user's profile path `/profile/:id/:slug`.
     - Inserts the activity post entry into `activities` with a deterministic primary key id: `welcome-YYYY-MM-DD` (where YYYY-MM-DD is yesterday's date string). If concurrent requests attempt to insert this entry, D1/SQLite throws a primary key uniqueness constraint error which the worker catches and ignores, preventing duplication.
     - Author is set to `authorId = "00000000-0000-0000-0000-000000000000"` (System User).
4. A simple in-memory caching key prevents redundant database evaluations for the remainder of the calendar day.

### 5.4 Notification Dispatcher & Read Updates
When content is created:
1. Parse the Rich Text Lexical JSON structure to resolve mentioned `@username` profiles.
2. **Mentions in Private Messages Bypass:** If the context type is a PM (`contextType === 'message'`), the parser **bypasses** sending `@mention` notifications to avoid leaking private message content to outside users.
3. Dispatch notifications to:
   - Mentioned users (if `mention` preference is true).
   - Discussion owner on new reply (if `discussionReply` preference is true).
   - Thread participants on new reply (if `participatedComment` preference is true).
   - Bookmark subscribers on category/thread activity (if `bookmarkedDiscussionComment` preference is true).
   - Target recipient on directed activity (if `profileComment` preference is true).
   - Private message thread recipients (if `privateMessage` preference is true).
4. **Automatic Notification Clearance:** When a user visits `/discussion/:id` or `/messages/:id`, SvelteKit server load function executes a database update setting `isRead = true` for all active notification records linked to the user and the thread.

---

## 6. SvelteKit Server Endpoints & Actions

The frontend interfaces with the following core backend routes:

### 6.1 Authentication Endpoints
- `/api/auth/register` (POST):
  1. Validates the provided `invitationCode`. Checks if it exists in `invitations`, has status `'unused'` (based on dynamic checks), and `expiresAt > now`. If invalid/expired/used, returns `400 Bad Request`.
  2. Enforces username/email checks and password validation (>= 5 chars).
  3. Hashes password via Web Crypto PBKDF2/scrypt.
  4. Creates the user record, updates the invitation status to `'used'`, sets `usedById` to the new user ID.
  5. Signs JWT, sets session cookie (respecting Remember Me settings).
- `/api/auth/login` (POST): Verifies credentials, sets session cookie. If `rememberMe` checkbox is checked, configures cookie with `maxAge: 2592000` (30 days).
- `/api/auth/logout` (POST): Clears session cookie.

### 6.2 RSS Feed API (`/category/[categorySlug]/rss/+server.ts`)
- URL format: `/category/:categorySlug/rss?token=USER_RSS_TOKEN`.
- Server logic:
  1. Resolves user matching `rssToken`. Returns `401 Unauthorized` if not matched.
  2. Queries `categoryPermissions` checking if the user's `groupSlug` can read the requested category. Returns `403 Forbidden` if denied.
  3. Formulates category metadata and lists the 20 most recent discussions, generating XML response payload.

### 6.3 Page Load Helpers (Automatic Resume & Updates)
- `/discussion/[id]` server load handler updates `discussionReads` setting `lastReadAt = now`, `lastReadPage = page`, and `lastReadReplyId = lastReplyIdOnPage`. It also resolves all pending user notifications for this thread and marks them as read. It increments `discussions.viewCount` by 1.
- `/messages/[id]` server load handler updates `conversationReads` setting `lastReadAt = now`.
- `/profile/[id]` server load handler increments `users.viewCount` by 1. Self-views (if authenticated user ID matches profile ID) are ignored.
- `/profile/discussions/[userId]` server load handler fetches discussions authored by target user (20 items per page limit, filters out deleted posts).
- `/profile/comments/[userId]` server load handler queries only discussion replies (`replies` table) authored by the target user, returning them sorted by creation time. Activity comments are excluded from this profile view to align with discussion links.

### 6.4 API Endpoints
- `/api/drafts/save` (POST): Upserts draft records containing user id, context, and JSON.
- `/api/notifications` (GET): Fetches notifications list for the active user, sorted by creation timestamp.
- `/api/notifications` (PUT): Accepts an array of notification IDs or a global parameter to mark notifications as read.
- `/api/bookmarks` (GET): Fetches the user's bookmarked discussions. Supports `page` and `limit` query parameters for full listing. Tooltips widget fetches with `limit=5`.
- `/api/messages/recent` (GET): Fetches the 5 most recent active conversations.
- `/api/invitations` (GET): Queries all invitation codes generated by the active user. Dynamically evaluates the status of each record:
  - If `usedById !== null` -> `'used'`
  - If `usedById === null && expiresAt < now` -> `'expired'`
  - Otherwise -> `'unused'`
- `/api/invitations/request` (POST):
  1. Validates authentication status.
  2. Queries invitation table to count codes requested by the user in the current calendar month (using timezone configured via `FORUM_TIMEZONE` variables).
  3. If count >= `MONTHLY_INVITATION_LIMIT`, returns `400 Bad Request`.
  4. Generates unique 12-char invitation code, sets creator ID, `createdAt = now`, `expiresAt = now + 7 days` (1 week validity), and inserts.

### 6.5 SvelteKit Actions
- `addParticipant` (Action in `/messages/[id]`): Accepts target user ID, validates that the active user requesting addition is currently a participant in the conversation, and adds the target user to the conversation.

### 6.6 Configuration Environment Variables
- `PAGINATION_LIMIT`: Integer controlling replies per page (defaults to `50`).
- `DISCUSSIONS_LIMIT`: Integer controlling discussions per page (defaults to `20`).
- `ACTIVITIES_LIMIT`: Integer controlling activity square items per page (defaults to `15`).
- `FORUM_TIMEZONE`: String representing regional timezone (e.g. `Asia/Shanghai`, defaults to `UTC`).
- `WELCOME_TEXT`: String representing localized welcome header format.
- `JWT_SECRET`: Secret key for token verification.
- `PCLOUD_TOKEN`, `PCLOUD_FOLDER_ID`: Access values for image reverse proxying.
- `MONTHLY_INVITATION_LIMIT`: Integer representing the monthly request limit of invitation codes per user (defaults to `5`).

### 6.7 SvelteKit Parameter Matchers
To prevent route collisions on optional SvelteKit parameters (e.g. in `/discussion/[discussionId]/[slug]/[[page]]`), the page parameter is configured with a parameter matcher in `src/params/page.ts`:
```typescript
export function match(param) {
  return /^p\d+$/.test(param);
}
```
This forces optional parameters to match directories structured as `[[page=page]]`.

---

## 7. Database Migration & Seeding Specification

### 7.1 Seeding Operations
To satisfy foreign key constraints and prevent database crashes, a seed script is executed post-migration:
1. Provisions default user groups in the `user_groups` table:
   - `system`: Slug for automation bots.
   - `admin`: Super-administrators with full permission scopes.
   - `moderator`: Forum moderators with intermediate permissions.
   - `member`: Standard user role.
2. Seeds the System User (`00000000-0000-0000-0000-000000000000`) linked to the `system` group slug.
3. If no accounts exist in `users`, parses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from environmental variables to bootstrap the root administrator user under the `admin` group slug.

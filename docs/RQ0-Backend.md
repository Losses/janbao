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

The schema defines the relational layout for users, categories, discussions, messages, activities, and notification states.

### 2.1 Schema Definition Code (`schema.ts`)
The schema definition maps directly to SQLite data types:

```typescript
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
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
});

export const replies = sqliteTable('replies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  discussionId: text('discussion_id').notNull().references(() => discussions.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => users.id),
  contentJson: text('content_json').notNull(), // Lexical JSON State
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }), // Soft delete support
});

// --- User Context States ---
export const bookmarks = sqliteTable('bookmarks', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  discussionId: text('discussion_id').notNull().references(() => discussions.id, { onDelete: 'cascade' }),
  bookmarkedAt: integer('bookmarked_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.discussionId] }),
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
});

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
}));

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => users.id),
  contentJson: text('content_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }), // Soft delete support
});

// --- Activities (Microblog) ---
export const activities = sqliteTable('activities', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  authorId: text('author_id').notNull().references(() => users.id),
  recipientId: text('recipient_id').references(() => users.id), // For A -> B dynamic target
  contentJson: text('content_json').notNull(),
  parentActivityId: text('parent_activity_id'), // Single level comment thread structure
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }), // Soft delete support
});

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
});

export const notificationPreferences = sqliteTable('notification_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  profileComment: integer('profile_comment', { mode: 'boolean' }).notNull().default(true),
  discussionReply: integer('discussion_reply', { mode: 'boolean' }).notNull().default(true),
  privateMessage: integer('private_message', { mode: 'boolean' }).notNull().default(true),
  discussionComment: integer('discussion_comment', { mode: 'boolean' }).notNull().default(true),
  participatedComment: integer('participated_comment', { mode: 'boolean' }).notNull().default(true),
  mention: integer('mention', { mode: 'boolean' }).notNull().default(true),
});
```

---

## 3. Session Management & Authentication

Instead of utilizing heavy framework bindings, a custom JWT mechanism is implemented via SvelteKit hooks.

### 3.1 Session Verification Flow
- **Token Type:** JSON Web Token (JWT) signed using a secret key defined in environment variables (`JWT_SECRET`) utilizing `HMAC SHA-256`.
- **Token Delivery:** Stored in a secure, `HttpOnly`, `SameSite=Strict`, `Secure` cookie named `session_token`.
- **JWT Content Structure:**
  ```json
  {
    "sub": "user-uuid-value",
    "username": "janedoe",
    "role": "moderator",
    "exp": 1718131200
  }
  ```
- **JWT Interceptor (`src/hooks.server.ts`):**
  On every server request:
  1. Retrieve `session_token` cookie.
  2. If present, verify signature and expiration.
  3. Resolve user details from the payload and inject them into `event.locals.user`.
  4. If invalid or expired, clear the cookie and set `event.locals.user = null`.

### 3.2 Authorization Gates
Routes are protected on the server side using SvelteKit's `layout.server.ts` or endpoint handlers:
- **Admin Section Protection:** Verifies if `event.locals.user.role === 'admin'`. If not, throws a 403 Forbidden error.
- **Category CRUD Permissions:** Queries the `categoryPermissions` table matching the user's `groupSlug` to check authorization flag states before servicing read or write mutations.

---

## 4. pCloud File Upload & Reverse Proxy API

To circumvent domain-level network blocks, SvelteKit functions as an inline reverse proxy to pCloud services.

```
[Browser Client] 
     | (POST /upload - max 5MB / 1MB avatar)
     v
[SvelteKit API Route: /upload]
     | (Append PCLOUD_TOKEN & folderid)
     v
[pCloud HTTP API: /uploadfile]
     | (Returns fileid)
     v
[SvelteKit API Route] ---> (Returns JSON: url: "https://yourdomain.com/img/<fileid>")
```

### 4.1 Proxy Route: Image Retrieval (`/img/[fileid]/+server.ts`)
1. Receives request for `/img/<fileid>`.
2. Initiates server-side request to `https://api.pcloud.com/getfilelink?auth=${PCLOUD_TOKEN}&fileid=${fileid}`.
3. Parses resulting JSON object to extract `hosts[0]` and `path`.
4. Executes sub-fetch to retrieval URL `https://${host}${path}`.
5. Pipe the image stream directly back to the client response, returning an identical Content-Type header.
6. **CDN Optimization:** Injects header `Cache-Control: public, max-age=31536000` (1 year). Cloudflare CDN edges cache this response.

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
    // Add additional mappings matching _UrlTranslations from class.format.php as needed
  };

  cleaned = cleaned.split('').map(char => urlTranslations[char] || char).join('');
  
  // 2. Strip single quotes
  cleaned = cleaned.replace(/[']/g, '');

  // 3. Replace all non-alphanumeric/spaces with hyphens
  cleaned = cleaned.replace(/[\s\W_]+/g, '-');

  // 4. Squeeze multiple hyphens, convert to lowercase, trim hyphens
  cleaned = cleaned.replace(/-+/g, '-').toLowerCase();
  
  return encodeURIComponent(cleaned.replace(/^-+|-+$/g, ''));
}
```

### 5.2 Active Users Wall tracking
- **Update Rule:** On authenticated page transitions, the server checks if the user's `lastActiveTime` is older than 60 seconds. If so, a background update query updates `lastActiveTime = now` in the database. This throttles write queries to D1.
- **Fetch Rule:** Online list filters out users with `isStealth = true` or `lastActiveTime` older than 10 minutes.

### 5.3 Daily Welcome Post Generation (Check-on-Access Pattern)
Instead of running Cron triggers, the welcome post generation is executed inline during access-token verification:
1. When a user requests resources, the server queries the database (using local server timezone configurations) to verify if a welcome post for the current date has already been published in the Activity Square table.
2. If it does not exist:
   - Queries `users` signed up between `yesterday 00:00:00` and `yesterday 23:59:59`.
   - If the signup count > 0:
     - Formulates the localized welcome post string (e.g. "Welcome to join: UserA, UserB!").
     - Inserts the activity post entry into `activities` with system identity configurations.
3. A simple cache flag blocks repeated database checks for the duration of the calendar day.

### 5.4 Notification Dispatcher
When a discussion post, reply, or comment is created:
1. Parse the Rich Text Lexical JSON content structure to extract mention targets matching patterns of type `@username`.
2. Query `users` to resolve matching UUIDs.
3. Validate user preferences in `notificationPreferences`.
4. If notifications are enabled, batch insert entries into the `notifications` table.

---

## 6. Database Migrations & Seed Management

- **Migration Tooling:** Managed via `drizzle-kit`.
- **Workflow:**
  1. Change `schema.ts`.
  2. Run `bun run db:generate` to output SQL migrations locally.
  3. Run `bun run db:push` for local validation.
  4. Wrangler CLI maps D1 migrations on deployments: `wrangler d1 migrations apply <db_name> --remote`.
- **System Seeding:** An initial seed script populates the default `admin` and `user` groups in `user_groups`. If the `users` table is completely empty, it parses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from environmental variables to insert the root super-administrator.

import {
	sqliteTable,
	text,
	integer,
	primaryKey,
	index,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// --- User & Group Schemas ---
export const userGroups = sqliteTable('user_groups', {
	slug: text('slug').primaryKey(),
	title: text('title').notNull(),
	description: text('description').notNull(),
	permissionsJson: text('permissions_json').notNull().default('{}')
});

export const users = sqliteTable('users', {
	id: integer('id').primaryKey(),
	username: text('username').notNull().unique(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	displayName: text('display_name').notNull(),
	avatarFileId: text('avatar_file_id'),
	avatarContentType: text('avatar_content_type'),
	groupSlug: text('group_slug')
		.notNull()
		.references(() => userGroups.slug),
	signupTime: integer('signup_time', { mode: 'timestamp' })
		.notNull()
		.default(sql`(strftime('%s', 'now'))`),
	lastActiveTime: integer('last_active_time', { mode: 'timestamp' })
		.notNull()
		.default(sql`(strftime('%s', 'now'))`),
	showEmail: integer('show_email', { mode: 'boolean' }).notNull().default(false),
	languagePreference: text('language_preference').notNull().default('en'),
	isStealth: integer('is_stealth', { mode: 'boolean' }).notNull().default(false),
	rssToken: text('rss_token')
		.notNull()
		.unique()
		.$defaultFn(() => crypto.randomUUID()),
	viewCount: integer('view_count').notNull().default(0)
});

// --- Forum Schema ---
export const categories = sqliteTable('categories', {
	slug: text('slug').primaryKey(),
	title: text('title').notNull(),
	description: text('description').notNull(),
	priority: integer('priority').notNull().default(1),
	displayOrder: integer('display_order').notNull().default(1),
	themeName: text('theme_name')
});

export const categoryPermissions = sqliteTable(
	'category_permissions',
	{
		categorySlug: text('category_slug')
			.notNull()
			.references(() => categories.slug, { onDelete: 'cascade' }),
		groupSlug: text('group_slug')
			.notNull()
			.references(() => userGroups.slug, { onDelete: 'cascade' }),
		canCreate: integer('can_create', { mode: 'boolean' }).notNull().default(true),
		canRead: integer('can_read', { mode: 'boolean' }).notNull().default(true),
		canUpdate: integer('can_update', { mode: 'boolean' }).notNull().default(true),
		canDelete: integer('can_delete', { mode: 'boolean' }).notNull().default(true)
	},
	(table) => ({
		pk: primaryKey({ columns: [table.categorySlug, table.groupSlug] })
	})
);

export const discussions = sqliteTable(
	'discussions',
	{
		id: integer('id').primaryKey(),
		title: text('title').notNull(),
		slug: text('slug').notNull(),
		categorySlug: text('category_slug')
			.notNull()
			.references(() => categories.slug),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		viewCount: integer('view_count').notNull().default(0),
		commentCount: integer('comment_count').notNull().default(0),
		isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
		themeName: text('theme_name'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(table) => ({
		categoryIdx: index('discussions_category_idx').on(table.categorySlug),
		authorIdx: index('discussions_author_idx').on(table.authorId),
		createdIdx: index('discussions_created_idx').on(table.createdAt),
		updatedIdx: index('discussions_updated_idx').on(table.updatedAt),
		categoryUpdatedIdx: index('discussions_category_updated_idx').on(
			table.categorySlug,
			table.updatedAt
		)
	})
);

export const replies = sqliteTable(
	'replies',
	{
		id: integer('id').primaryKey(),
		discussionId: integer('discussion_id')
			.notNull()
			.references(() => discussions.id, { onDelete: 'cascade' }),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		contentJson: text('content_json').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(table) => ({
		discussionIdx: index('replies_discussion_idx').on(table.discussionId),
		authorIdx: index('replies_author_idx').on(table.authorId),
		createdIdx: index('replies_created_idx').on(table.createdAt),
		discussionCreatedIdx: index('replies_discussion_created_idx').on(
			table.discussionId,
			table.createdAt
		)
	})
);

export const bookmarks = sqliteTable(
	'bookmarks',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		discussionId: integer('discussion_id')
			.notNull()
			.references(() => discussions.id, { onDelete: 'cascade' }),
		bookmarkedAt: integer('bookmarked_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`)
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.discussionId] }),
		discussionIdx: index('bookmarks_discussion_idx').on(table.discussionId),
		userBookmarkedIdx: index('bookmarks_user_bookmarked_idx').on(table.userId, table.bookmarkedAt)
	})
);

export const discussionReads = sqliteTable(
	'discussion_reads',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		discussionId: integer('discussion_id')
			.notNull()
			.references(() => discussions.id, { onDelete: 'cascade' }),
		lastReadAt: integer('last_read_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		lastReadPage: integer('last_read_page').notNull().default(1),
		lastReadReplyId: integer('last_read_reply_id')
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.discussionId] })
	})
);

export const drafts = sqliteTable(
	'drafts',
	{
		id: integer('id').primaryKey(),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		contextType: text('context_type').notNull(),
		contextId: integer('context_id'),
		contentJson: text('content_json').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`)
	},
	(table) => ({
		authorIdx: index('drafts_author_idx').on(table.authorId),
		uniqDraftIdx: uniqueIndex('drafts_uniq_idx').on(
			table.authorId,
			table.contextType,
			table.contextId
		)
	})
);

export const conversations = sqliteTable('conversations', {
	id: integer('id').primaryKey(),
	title: text('title').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(strftime('%s', 'now'))`),
	deletedAt: integer('deleted_at', { mode: 'timestamp' })
});

export const conversationParticipants = sqliteTable(
	'conversation_participants',
	{
		conversationId: integer('conversation_id')
			.notNull()
			.references(() => conversations.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		joinedAt: integer('joined_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`)
	},
	(table) => ({
		pk: primaryKey({ columns: [table.conversationId, table.userId] }),
		userIdIdx: index('conversation_participants_user_idx').on(table.userId)
	})
);

export const messages = sqliteTable(
	'messages',
	{
		id: integer('id').primaryKey(),
		conversationId: integer('conversation_id')
			.notNull()
			.references(() => conversations.id, { onDelete: 'cascade' }),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		contentJson: text('content_json').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`)
	},
	(table) => ({
		conversationIdx: index('messages_conversation_idx').on(table.conversationId),
		authorIdx: index('messages_author_idx').on(table.authorId)
	})
);

export const conversationReads = sqliteTable(
	'conversation_reads',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		conversationId: integer('conversation_id')
			.notNull()
			.references(() => conversations.id, { onDelete: 'cascade' }),
		lastReadAt: integer('last_read_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`)
	},
	(table) => ({
		pk: primaryKey({ columns: [table.userId, table.conversationId] })
	})
);

export const activities = sqliteTable(
	'activities',
	{
		id: integer('id').primaryKey(),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		recipientId: integer('recipient_id').references(() => users.id),
		contentJson: text('content_json').notNull(),
		parentActivityId: integer('parent_activity_id'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(table) => ({
		authorIdx: index('activities_author_idx').on(table.authorId),
		parentIdx: index('activities_parent_idx').on(table.parentActivityId),
		recipientIdx: index('activities_recipient_idx').on(table.recipientId),
		createdIdx: index('activities_created_idx').on(table.createdAt),
		parentCreatedIdx: index('activities_parent_created_idx').on(
			table.parentActivityId,
			table.createdAt
		)
	})
);

export const notifications = sqliteTable(
	'notifications',
	{
		id: integer('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		sourceUserId: integer('source_user_id').references(() => users.id, { onDelete: 'cascade' }),
		discussionId: integer('discussion_id'),
		replyId: integer('reply_id'),
		activityId: integer('activity_id'),
		isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`)
	},
	(table) => ({
		userReadIdx: index('notifications_user_read_idx').on(table.userId, table.isRead),
		userCreatedIdx: index('notifications_user_created_idx').on(table.userId, table.createdAt)
	})
);

export const notificationPreferences = sqliteTable('notification_preferences', {
	userId: integer('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	profileComment: integer('profile_comment', { mode: 'boolean' }).notNull().default(true),
	discussionReply: integer('discussion_reply', { mode: 'boolean' }).notNull().default(true),
	discussionComment: integer('discussion_comment', { mode: 'boolean' }).notNull().default(true),
	participatedComment: integer('participated_comment', { mode: 'boolean' }).notNull().default(true),
	mention: integer('mention', { mode: 'boolean' }).notNull().default(true),
	bookmarkedDiscussionComment: integer('bookmarked_discussion_comment', { mode: 'boolean' })
		.notNull()
		.default(true)
});

export const attachments = sqliteTable(
	'attachments',
	{
		fileId: text('file_id').primaryKey(),
		contentType: text('content_type').notNull(),
		uploaderId: integer('uploader_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`)
	},
	(table) => ({
		uploaderIdx: index('attachments_uploader_idx').on(table.uploaderId)
	})
);

export const invitations = sqliteTable(
	'invitations',
	{
		code: text('code').primaryKey(),
		creatorId: integer('creator_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		usedById: integer('used_by_id').references(() => users.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
	},
	(table) => ({
		creatorIdx: index('invitations_creator_idx').on(table.creatorId)
	})
);

export const passwordRecoveries = sqliteTable(
	'password_recoveries',
	{
		id: integer('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
	},
	(table) => ({
		tokenIdx: index('password_recoveries_token_idx').on(table.token)
	})
);

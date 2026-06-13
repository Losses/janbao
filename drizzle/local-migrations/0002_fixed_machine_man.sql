PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`recipient_id` text,
	`content_json` text NOT NULL,
	`parent_activity_id` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_activities`("id", "author_id", "recipient_id", "content_json", "parent_activity_id", "created_at", "deleted_at") SELECT "id", "author_id", "recipient_id", "content_json", "parent_activity_id", "created_at", "deleted_at" FROM `activities`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `__new_activities` RENAME TO `activities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `activities_author_idx` ON `activities` (`author_id`);--> statement-breakpoint
CREATE INDEX `activities_parent_idx` ON `activities` (`parent_activity_id`);--> statement-breakpoint
CREATE INDEX `activities_recipient_idx` ON `activities` (`recipient_id`);--> statement-breakpoint
CREATE INDEX `activities_created_idx` ON `activities` (`created_at`);--> statement-breakpoint
CREATE INDEX `activities_parent_created_idx` ON `activities` (`parent_activity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_attachments` (
	`file_id` text PRIMARY KEY NOT NULL,
	`uploader_id` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_attachments`("file_id", "uploader_id", "created_at") SELECT "file_id", "uploader_id", "created_at" FROM `attachments`;--> statement-breakpoint
DROP TABLE `attachments`;--> statement-breakpoint
ALTER TABLE `__new_attachments` RENAME TO `attachments`;--> statement-breakpoint
CREATE INDEX `attachments_uploader_idx` ON `attachments` (`uploader_id`);--> statement-breakpoint
CREATE TABLE `__new_bookmarks` (
	`user_id` text NOT NULL,
	`discussion_id` text NOT NULL,
	`bookmarked_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`user_id`, `discussion_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_bookmarks`("user_id", "discussion_id", "bookmarked_at") SELECT "user_id", "discussion_id", "bookmarked_at" FROM `bookmarks`;--> statement-breakpoint
DROP TABLE `bookmarks`;--> statement-breakpoint
ALTER TABLE `__new_bookmarks` RENAME TO `bookmarks`;--> statement-breakpoint
CREATE INDEX `bookmarks_discussion_idx` ON `bookmarks` (`discussion_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_user_bookmarked_idx` ON `bookmarks` (`user_id`,`bookmarked_at`);--> statement-breakpoint
CREATE TABLE `__new_conversation_participants` (
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`conversation_id`, `user_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_conversation_participants`("conversation_id", "user_id", "joined_at") SELECT "conversation_id", "user_id", "joined_at" FROM `conversation_participants`;--> statement-breakpoint
DROP TABLE `conversation_participants`;--> statement-breakpoint
ALTER TABLE `__new_conversation_participants` RENAME TO `conversation_participants`;--> statement-breakpoint
CREATE INDEX `conversation_participants_user_idx` ON `conversation_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_conversation_reads` (
	`user_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`last_read_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`user_id`, `conversation_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_conversation_reads`("user_id", "conversation_id", "last_read_at") SELECT "user_id", "conversation_id", "last_read_at" FROM `conversation_reads`;--> statement-breakpoint
DROP TABLE `conversation_reads`;--> statement-breakpoint
ALTER TABLE `__new_conversation_reads` RENAME TO `conversation_reads`;--> statement-breakpoint
CREATE TABLE `__new_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_conversations`("id", "title", "created_at", "deleted_at") SELECT "id", "title", "created_at", "deleted_at" FROM `conversations`;--> statement-breakpoint
DROP TABLE `conversations`;--> statement-breakpoint
ALTER TABLE `__new_conversations` RENAME TO `conversations`;--> statement-breakpoint
CREATE TABLE `__new_discussion_reads` (
	`user_id` text NOT NULL,
	`discussion_id` text NOT NULL,
	`last_read_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`last_read_page` integer DEFAULT 1 NOT NULL,
	`last_read_reply_id` text,
	PRIMARY KEY(`user_id`, `discussion_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_discussion_reads`("user_id", "discussion_id", "last_read_at", "last_read_page", "last_read_reply_id") SELECT "user_id", "discussion_id", "last_read_at", "last_read_page", "last_read_reply_id" FROM `discussion_reads`;--> statement-breakpoint
DROP TABLE `discussion_reads`;--> statement-breakpoint
ALTER TABLE `__new_discussion_reads` RENAME TO `discussion_reads`;--> statement-breakpoint
CREATE TABLE `__new_discussions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`category_slug` text NOT NULL,
	`author_id` text NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`theme_name` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`category_slug`) REFERENCES `categories`(`slug`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_discussions`("id", "title", "slug", "category_slug", "author_id", "view_count", "comment_count", "is_pinned", "theme_name", "created_at", "updated_at", "deleted_at") SELECT "id", "title", "slug", "category_slug", "author_id", "view_count", "comment_count", "is_pinned", "theme_name", "created_at", "updated_at", "deleted_at" FROM `discussions`;--> statement-breakpoint
DROP TABLE `discussions`;--> statement-breakpoint
ALTER TABLE `__new_discussions` RENAME TO `discussions`;--> statement-breakpoint
CREATE INDEX `discussions_category_idx` ON `discussions` (`category_slug`);--> statement-breakpoint
CREATE INDEX `discussions_author_idx` ON `discussions` (`author_id`);--> statement-breakpoint
CREATE INDEX `discussions_created_idx` ON `discussions` (`created_at`);--> statement-breakpoint
CREATE INDEX `discussions_updated_idx` ON `discussions` (`updated_at`);--> statement-breakpoint
CREATE INDEX `discussions_category_updated_idx` ON `discussions` (`category_slug`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`context_type` text NOT NULL,
	`context_id` text,
	`content_json` text NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_drafts`("id", "author_id", "context_type", "context_id", "content_json", "updated_at") SELECT "id", "author_id", "context_type", "context_id", "content_json", "updated_at" FROM `drafts`;--> statement-breakpoint
DROP TABLE `drafts`;--> statement-breakpoint
ALTER TABLE `__new_drafts` RENAME TO `drafts`;--> statement-breakpoint
CREATE INDEX `drafts_author_idx` ON `drafts` (`author_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_uniq_idx` ON `drafts` (`author_id`,`context_type`,`context_id`);--> statement-breakpoint
CREATE TABLE `__new_invitations` (
	`code` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`used_by_id` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_invitations`("code", "creator_id", "used_by_id", "created_at", "expires_at") SELECT "code", "creator_id", "used_by_id", "created_at", "expires_at" FROM `invitations`;--> statement-breakpoint
DROP TABLE `invitations`;--> statement-breakpoint
ALTER TABLE `__new_invitations` RENAME TO `invitations`;--> statement-breakpoint
CREATE INDEX `invitations_creator_idx` ON `invitations` (`creator_id`);--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_messages`("id", "conversation_id", "author_id", "content_json", "created_at", "updated_at") SELECT "id", "conversation_id", "author_id", "content_json", "created_at", "updated_at" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `messages_author_idx` ON `messages` (`author_id`);--> statement-breakpoint
CREATE TABLE `__new_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`source_user_id` text,
	`discussion_id` text,
	`reply_id` text,
	`message_id` text,
	`activity_id` text,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("id", "user_id", "type", "source_user_id", "discussion_id", "reply_id", "message_id", "activity_id", "is_read", "created_at") SELECT "id", "user_id", "type", "source_user_id", "discussion_id", "reply_id", "message_id", "activity_id", "is_read", "created_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`discussion_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_replies`("id", "discussion_id", "author_id", "content_json", "created_at", "updated_at", "deleted_at") SELECT "id", "discussion_id", "author_id", "content_json", "created_at", "updated_at", "deleted_at" FROM `replies`;--> statement-breakpoint
DROP TABLE `replies`;--> statement-breakpoint
ALTER TABLE `__new_replies` RENAME TO `replies`;--> statement-breakpoint
CREATE INDEX `replies_discussion_idx` ON `replies` (`discussion_id`);--> statement-breakpoint
CREATE INDEX `replies_author_idx` ON `replies` (`author_id`);--> statement-breakpoint
CREATE INDEX `replies_created_idx` ON `replies` (`created_at`);--> statement-breakpoint
CREATE INDEX `replies_discussion_created_idx` ON `replies` (`discussion_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_file_id` text,
	`group_slug` text NOT NULL,
	`signup_time` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`last_active_time` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`show_email` integer DEFAULT false NOT NULL,
	`language_preference` text DEFAULT 'en' NOT NULL,
	`is_stealth` integer DEFAULT false NOT NULL,
	`rss_token` text NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_slug`) REFERENCES `user_groups`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "username", "email", "password_hash", "display_name", "avatar_file_id", "group_slug", "signup_time", "last_active_time", "show_email", "language_preference", "is_stealth", "rss_token", "view_count") SELECT "id", "username", "email", "password_hash", "display_name", "avatar_file_id", "group_slug", "signup_time", "last_active_time", "show_email", "language_preference", "is_stealth", "rss_token", "view_count" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_rss_token_unique` ON `users` (`rss_token`);--> statement-breakpoint
-- Repair historical millisecond values in users.signup_time / last_active_time.
-- These were written by the column DEFAULT (before this migration switched it
-- back to seconds) because register/seed inserts never set these columns.
-- Only values clearly in milliseconds (> 1e10) are divided, so any row that was
-- already in seconds (e.g. last_active_time updated via new Date()) is left
-- untouched. Integer division; idempotent and safe to re-run.
UPDATE `users` SET `signup_time` = `signup_time` / 1000 WHERE `signup_time` > 10000000000;--> statement-breakpoint
UPDATE `users` SET `last_active_time` = `last_active_time` / 1000 WHERE `last_active_time` > 10000000000;
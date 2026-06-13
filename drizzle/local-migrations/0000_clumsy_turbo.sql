CREATE TABLE `activities` (
	`id` integer PRIMARY KEY NOT NULL,
	`author_id` integer NOT NULL,
	`recipient_id` integer,
	`content_json` text NOT NULL,
	`parent_activity_id` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activities_author_idx` ON `activities` (`author_id`);--> statement-breakpoint
CREATE INDEX `activities_parent_idx` ON `activities` (`parent_activity_id`);--> statement-breakpoint
CREATE INDEX `activities_recipient_idx` ON `activities` (`recipient_id`);--> statement-breakpoint
CREATE INDEX `activities_created_idx` ON `activities` (`created_at`);--> statement-breakpoint
CREATE INDEX `activities_parent_created_idx` ON `activities` (`parent_activity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`file_id` text PRIMARY KEY NOT NULL,
	`uploader_id` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_uploader_idx` ON `attachments` (`uploader_id`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`user_id` integer NOT NULL,
	`discussion_id` integer NOT NULL,
	`bookmarked_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`user_id`, `discussion_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmarks_discussion_idx` ON `bookmarks` (`discussion_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_user_bookmarked_idx` ON `bookmarks` (`user_id`,`bookmarked_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`slug` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`display_order` integer DEFAULT 1 NOT NULL,
	`theme_name` text
);
--> statement-breakpoint
CREATE TABLE `category_permissions` (
	`category_slug` text NOT NULL,
	`group_slug` text NOT NULL,
	`can_create` integer DEFAULT true NOT NULL,
	`can_read` integer DEFAULT true NOT NULL,
	`can_update` integer DEFAULT true NOT NULL,
	`can_delete` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`category_slug`, `group_slug`),
	FOREIGN KEY (`category_slug`) REFERENCES `categories`(`slug`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_slug`) REFERENCES `user_groups`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conversation_participants` (
	`conversation_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`joined_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`conversation_id`, `user_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversation_participants_user_idx` ON `conversation_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `conversation_reads` (
	`user_id` integer NOT NULL,
	`conversation_id` integer NOT NULL,
	`last_read_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	PRIMARY KEY(`user_id`, `conversation_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `discussion_reads` (
	`user_id` integer NOT NULL,
	`discussion_id` integer NOT NULL,
	`last_read_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`last_read_page` integer DEFAULT 1 NOT NULL,
	`last_read_reply_id` integer,
	PRIMARY KEY(`user_id`, `discussion_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `discussions` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`category_slug` text NOT NULL,
	`author_id` integer NOT NULL,
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
CREATE INDEX `discussions_category_idx` ON `discussions` (`category_slug`);--> statement-breakpoint
CREATE INDEX `discussions_author_idx` ON `discussions` (`author_id`);--> statement-breakpoint
CREATE INDEX `discussions_created_idx` ON `discussions` (`created_at`);--> statement-breakpoint
CREATE INDEX `discussions_updated_idx` ON `discussions` (`updated_at`);--> statement-breakpoint
CREATE INDEX `discussions_category_updated_idx` ON `discussions` (`category_slug`,`updated_at`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` integer PRIMARY KEY NOT NULL,
	`author_id` integer NOT NULL,
	`context_type` text NOT NULL,
	`context_id` integer,
	`content_json` text NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drafts_author_idx` ON `drafts` (`author_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drafts_uniq_idx` ON `drafts` (`author_id`,`context_type`,`context_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`code` text PRIMARY KEY NOT NULL,
	`creator_id` integer NOT NULL,
	`used_by_id` integer,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`used_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invitations_creator_idx` ON `invitations` (`creator_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`conversation_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `messages_author_idx` ON `messages` (`author_id`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`profile_comment` integer DEFAULT true NOT NULL,
	`discussion_reply` integer DEFAULT true NOT NULL,
	`discussion_comment` integer DEFAULT true NOT NULL,
	`participated_comment` integer DEFAULT true NOT NULL,
	`mention` integer DEFAULT true NOT NULL,
	`bookmarked_discussion_comment` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`source_user_id` integer,
	`discussion_id` integer,
	`reply_id` integer,
	`activity_id` integer,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` integer PRIMARY KEY NOT NULL,
	`discussion_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`content_json` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `replies_discussion_idx` ON `replies` (`discussion_id`);--> statement-breakpoint
CREATE INDEX `replies_author_idx` ON `replies` (`author_id`);--> statement-breakpoint
CREATE INDEX `replies_created_idx` ON `replies` (`created_at`);--> statement-breakpoint
CREATE INDEX `replies_discussion_created_idx` ON `replies` (`discussion_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_groups` (
	`slug` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`permissions_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
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
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_rss_token_unique` ON `users` (`rss_token`);
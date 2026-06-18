CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh_key` text NOT NULL,
	`auth_key` text NOT NULL,
	`user_agent` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`last_error_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `push_profile_comment` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `push_discussion_reply` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `push_discussion_comment` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `push_participated_comment` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `push_mention` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `push_bookmarked_discussion_comment` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `push_message` integer DEFAULT true NOT NULL;
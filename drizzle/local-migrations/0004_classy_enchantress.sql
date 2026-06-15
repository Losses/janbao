CREATE TABLE `activity_joins` (
	`activity_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`activity_id`, `user_id`),
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_joins_user_idx` ON `activity_joins` (`user_id`);--> statement-breakpoint
ALTER TABLE `activities` ADD `is_joined` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `activities_joined_idx` ON `activities` (`is_joined`,`created_at`);
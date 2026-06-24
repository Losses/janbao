CREATE TABLE `ui_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`interface_theme` text,
	`block_post_theme` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

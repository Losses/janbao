CREATE TABLE `contribution_bucket_stats` (
	`bucket_type` text DEFAULT 'month' NOT NULL,
	`author_id` integer NOT NULL,
	`bucket` text NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`discussion_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`bucket_type`, `author_id`, `bucket`),
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

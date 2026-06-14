CREATE TABLE `password_recoveries` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_recoveries_token_unique` ON `password_recoveries` (`token`);--> statement-breakpoint
CREATE INDEX `password_recoveries_token_idx` ON `password_recoveries` (`token`);
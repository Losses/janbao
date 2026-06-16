CREATE TABLE `auth_throttle` (
	`bucket` text NOT NULL,
	`identifier` text NOT NULL,
	`window_epoch` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`bucket`, `identifier`, `window_epoch`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_lower_unique` ON `users` (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_lower_unique` ON `users` (lower("email"));
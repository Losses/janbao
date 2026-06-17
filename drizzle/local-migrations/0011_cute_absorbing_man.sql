CREATE TABLE `rate_limits` (
	`bucket` text NOT NULL,
	`identifier` text NOT NULL,
	`window_epoch` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`bucket`, `identifier`, `window_epoch`)
);

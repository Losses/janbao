CREATE INDEX `discussions_updated_id_idx` ON `discussions` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `discussions_deleted_idx` ON `discussions` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `replies_updated_id_idx` ON `replies` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `replies_deleted_idx` ON `replies` (`deleted_at`);
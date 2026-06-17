ALTER TABLE `discussions` ADD `last_reply_at` integer;--> statement-breakpoint
CREATE INDEX `discussions_last_reply_idx` ON `discussions` (`last_reply_at`);--> statement-breakpoint
CREATE INDEX `discussions_category_last_reply_idx` ON `discussions` (`category_slug`,`last_reply_at`);--> statement-breakpoint
-- Backfill last_reply_at: time of the latest non-deleted reply (OP included);
-- falls back to created_at for empty threads. Repairs drift from pin/edit/delete
-- bumps and the importer never recomputing it. Units are seconds (timestamp mode),
-- matching replies.created_at — no unit conversion needed.
UPDATE `discussions` SET `last_reply_at` = COALESCE(
  (SELECT MAX(r.`created_at`) FROM `replies` r
   WHERE r.`discussion_id` = `discussions`.`id` AND r.`deleted_at` IS NULL),
  `discussions`.`created_at`
);
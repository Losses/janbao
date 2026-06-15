ALTER TABLE `replies` ADD `edited_at` integer;--> statement-breakpoint
ALTER TABLE `replies` ADD `edited_by` integer REFERENCES users(id);--> statement-breakpoint
-- Backfill edited_at for replies edited before this column existed: updatedAt
-- was the old edit proxy (set on every content edit). editedBy stays NULL
-- since the editor identity wasn't recorded. Rows imported via import-data
-- carry updatedAt == createdAt, so the > 1s guard correctly skips them.
UPDATE `replies` SET `edited_at` = `updated_at` WHERE `updated_at` > `created_at` + 1;
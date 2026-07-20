-- Store the calendar-day bucket for isJoined activity rows so a
-- UNIQUE(is_joined, joined_day) index can serialize concurrent
-- first-of-the-day inserts. appendJoinedMember (joined-activity.ts) upserts
-- on this index via ON CONFLICT DO UPDATE: two signups on the same day both
-- compute the same joined_day, the index serializes them, and the second one
-- folds onto the first writer's row - guaranteeing exactly one activity row
-- per day bucket. SQLite UNIQUE indexes permit multiple NULLs, so non-joined
-- rows (joined_day IS NULL) are not constrained.
ALTER TABLE `activities` ADD `joined_day` text;--> statement-breakpoint
-- Backfill joined_day for existing isJoined rows from created_at. date() in
-- UTC matches the default FORUM_TIMEZONE. Non-default deployments may see
-- day-off-by-one for rows near midnight forum-tz; the deviation is
-- acceptable because the upsert key only needs to be deterministic per
-- signup-time bucket, not wall-clock-accurate to the original timezone.
UPDATE `activities`
SET `joined_day` = date(`created_at`, 'unixepoch')
WHERE `is_joined` = 1 AND `joined_day` IS NULL;--> statement-breakpoint
-- Dedupe any (is_joined, joined_day) buckets with more than one row so the
-- UNIQUE index creation below cannot fail. Per bucket the winner is MAX(id)
-- (deterministic). All activity_joins rows on the non-winners are repointed
-- to the winner; UPDATE OR IGNORE skips users who already exist on the
-- winner via the activity_joins (activity_id, user_id) PRIMARY KEY. The
-- non-winner activities are then deleted (cascades to any residual joins).
UPDATE OR IGNORE `activity_joins`
SET `activity_id` = (
	SELECT MAX(b.id)
	FROM `activities` b
	WHERE b.is_joined = (SELECT a.is_joined FROM `activities` a WHERE a.id = `activity_joins`.`activity_id`)
		AND b.joined_day = (SELECT a.joined_day FROM `activities` a WHERE a.id = `activity_joins`.`activity_id`)
)
WHERE `activity_id` IN (
	SELECT a_loser.id
	FROM `activities` a_loser
	WHERE a_loser.is_joined = 1
		AND a_loser.joined_day IS NOT NULL
		AND a_loser.id < (
			SELECT MAX(a_max.id) FROM `activities` a_max
			WHERE a_max.is_joined = a_loser.is_joined
				AND a_max.joined_day = a_loser.joined_day
		)
);--> statement-breakpoint
DELETE FROM `activities`
WHERE `id` IN (
	SELECT a_loser.id
	FROM `activities` a_loser
	WHERE a_loser.is_joined = 1
		AND a_loser.joined_day IS NOT NULL
		AND a_loser.id < (
			SELECT MAX(a_max.id) FROM `activities` a_max
			WHERE a_max.is_joined = a_loser.is_joined
				AND a_max.joined_day = a_loser.joined_day
		)
);--> statement-breakpoint
CREATE UNIQUE INDEX `activities_joined_day_unique` ON `activities` (`is_joined`,`joined_day`);

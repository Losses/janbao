import { discussionReads } from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { D1Db } from '../db/index';
import type { ReadStateConflict, ReadStateDelta } from '$lib/types/api';

interface ApplyReadStateInput {
	db: D1Db;
	userId: number;
	deltas: ReadStateDelta[];
	// Discussion ids the caller already validated as in a readable category.
	// Deltas referencing any other id are dropped (defense-in-depth).
	allowedDiscussionIds: Set<number>;
}

interface ApplyReadStateResult {
	applied: number;
	skipped: number;
	conflicts: ReadStateConflict[];
}

/**
 * Apply offline-accumulated read-state deltas with last-write-wins by `lastReadAt`.
 *
 * INV-4: this writes only `discussion_reads` (the read-state row the online view
 * also writes) and NEVER flips `notifications.is_read` - the notification
 * reconciliation is the side-effect the offline sync must not perform. The next
 * time the user opens the discussion online, the read-page path reconciles
 * notification state from the read-state advanced here.
 */
export async function applyReadStateDeltas(
	input: ApplyReadStateInput
): Promise<ApplyReadStateResult> {
	let applied = 0;
	let skipped = 0;
	const conflicts: ReadStateConflict[] = [];

	for (const delta of input.deltas) {
		if (!input.allowedDiscussionIds.has(delta.discussionId)) {
			skipped++;
			continue;
		}

		const existing = await input.db
			.select({
				lastReadAt: discussionReads.lastReadAt,
				lastReadReplyId: discussionReads.lastReadReplyId
			})
			.from(discussionReads)
			.where(
				and(
					eq(discussionReads.userId, input.userId),
					eq(discussionReads.discussionId, delta.discussionId)
				)
			)
			.limit(1);

		// Server has a strictly newer read: the offline read is stale, the online read
		// (possibly on another device) wins -> skip and report the conflict.
		const serverLastReadAt = existing[0]
			? Math.floor(existing[0].lastReadAt.getTime() / 1000)
			: null;
		if (serverLastReadAt !== null && serverLastReadAt > delta.lastReadAt) {
			skipped++;
			conflicts.push({
				discussionId: delta.discussionId,
				serverLastReadAt,
				serverLastReadReplyId: existing[0]?.lastReadReplyId ?? null
			});
			continue;
		}

		const stamped = new Date(delta.lastReadAt * 1000);
		await input.db
			.insert(discussionReads)
			.values({
				userId: input.userId,
				discussionId: delta.discussionId,
				lastReadAt: stamped,
				lastReadPage: delta.lastReadPage,
				lastReadReplyId: delta.lastReadReplyId
			})
			.onConflictDoUpdate({
				target: [discussionReads.userId, discussionReads.discussionId],
				set: {
					lastReadAt: stamped,
					lastReadPage: delta.lastReadPage,
					lastReadReplyId: delta.lastReadReplyId
				},
				// Close the SELECT-to-UPSERT race: only advance when the server row is
				// not newer. The column stores seconds; delta.lastReadAt is seconds.
				where: sql`${discussionReads.lastReadAt} <= ${delta.lastReadAt}`
			});
		applied++;
	}

	return { applied, skipped, conflicts };
}

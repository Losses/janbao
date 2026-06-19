import { getOfflineDB } from './idb';
import type { Reason, SyncMetaValue } from './types';

// Offline cache retention fallback. DV06 used this as the primary eviction
// signal (drop cached rows whose lastReplyAt is older than retentionDays AND
// not on the front page / bookmarked). DV07 shifts to reason-set eviction:
// a row is dropped only when its `reasons` array is empty after the sync
// recompute. The retention window stays as a safety net for legacy v3 rows
// that have no reasons field yet (the next sync repopulates reasons; this
// gate just keeps the cache bounded in the meantime). C05 reuses the constant
// for the 'read' reason TTL.
export const OFFLINE_RETENTION_DAYS = 14;
const DAY_SECONDS = 86400;
const DEFAULT_RETENTION_DAYS = 14;

function asNumberArray(value: SyncMetaValue | undefined): number[] {
	return Array.isArray(value) ? (value.filter((v) => typeof v === 'number') as number[]) : [];
}

// True iff the row has any reason to remain cached. Pre-v4 rows (no reasons
// field) fall through to the retention fallback below so DV06 behavior is
// preserved during the v3→v4 upgrade window.
function hasReason(reasons: Reason[] | undefined): boolean {
	return Array.isArray(reasons) && reasons.length > 0;
}

/**
 * DV07 reason-set eviction: delete a discussion (cascading replies + merged
 * read-state, NEVER the pending read-state outbox) only when its reason set
 * is empty after the sync recompute. Rows still carrying reasons (latest /
 * mostViewed / mostReplied / read / front / bookmark) are exempt regardless
 * of age.
 *
 * For pre-v4 rows that lack `reasons`, the DV06 rule still applies: drop if
 * off the front page AND off the bookmark list AND older than the retention
 * window. The next sync tags these rows with reasons and they migrate to the
 * reason-set path. `readStatePending` is never evicted (outbox must still
 * sync even if its discussion scrolled out of cache).
 */
export async function applyEviction(): Promise<void> {
	const db = getOfflineDB();
	const frontRow = await db.syncMeta.get('frontPageSnapshot');
	const bookmarksRow = await db.syncMeta.get('bookmarksSnapshot');
	const retentionRow = await db.syncMeta.get('retentionDays');
	const skewRow = await db.syncMeta.get('serverTimeSkew');

	const front = new Set<number>(asNumberArray(frontRow?.value));
	const bookmarks = new Set<number>(asNumberArray(bookmarksRow?.value));
	const retentionDays =
		typeof retentionRow?.value === 'number' ? retentionRow.value : DEFAULT_RETENTION_DAYS;
	const skew = typeof skewRow?.value === 'number' ? skewRow.value : 0;
	const cutoffSec = Math.floor(Date.now() / 1000) + skew - retentionDays * DAY_SECONDS;

	const all = await db.discussions.toArray();
	const toEvict = all.filter((d) => {
		// Reason-tagged rows are always exempt (the new primary gate).
		if (hasReason(d.reasons)) return false;
		// Legacy v3 row OR a row whose reasons were never repopulated: fall
		// back to the DV06 rule so the cache still drains stale entries.
		return !front.has(d.id) && !bookmarks.has(d.id) && (d.lastReplyAt ?? d.createdAt) < cutoffSec;
	});
	if (toEvict.length === 0) return;

	await db.transaction('rw', db.discussions, db.replies, db.readStateMerged, async () => {
		for (const d of toEvict) {
			await db.discussions.delete(d.id);
			const replyKeys = await db.replies.where('discussionId').equals(d.id).primaryKeys();
			if (replyKeys.length) await db.replies.bulkDelete(replyKeys);
			await db.readStateMerged.delete(d.id);
			// Manifest rows are scoped to discussions that no longer exist; clear
			// them so the gap-renderer never reads a dangling manifest.
			await db.replyCacheManifest.delete(d.id);
		}
	});
}

import { getOfflineDB } from './idb';
import type { SyncMetaValue } from './types';

const DAY_SECONDS = 86400;
const DEFAULT_RETENTION_DAYS = 14;

function asNumberArray(value: SyncMetaValue | undefined): number[] {
	return Array.isArray(value) ? (value.filter((v) => typeof v === 'number') as number[]) : [];
}

/**
 * Drop cached discussions that are no longer on the front page AND older than the
 * retention window, cascading their replies and merged read-state. Bookmarked
 * discussions are exempt. The pending read-state outbox is never evicted - an
 * offline read must still sync back even if its discussion scrolls out of cache.
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
	const toEvict = all.filter(
		(d) => !front.has(d.id) && !bookmarks.has(d.id) && (d.lastReplyAt ?? d.createdAt) < cutoffSec
	);
	if (toEvict.length === 0) return;

	await db.transaction('rw', db.discussions, db.replies, db.readStateMerged, async () => {
		for (const d of toEvict) {
			await db.discussions.delete(d.id);
			const replyKeys = await db.replies.where('discussionId').equals(d.id).primaryKeys();
			if (replyKeys.length) await db.replies.bulkDelete(replyKeys);
			await db.readStateMerged.delete(d.id);
		}
	});
}

import { getOfflineDB } from './idb';
import { applyEviction } from './evict';
import { flushPendingReadState } from './read-state';
import type { SyncContentResponse, SyncCursors, SyncUserDTO } from '$lib/types/api';
import type { SyncResult } from './types';

const PAGE_LIMIT = 100;
// Cap pages per run so a single reconnect never loops unboundedly through a huge
// back-history. The cursor persists between runs, so a capped run simply resumes
// next time.
const MAX_PAGES = 20;

const EMPTY_RESULT: SyncResult = { discussions: 0, replies: 0, tombstones: 0 };

let inflight: Promise<SyncResult> | null = null;

/** Run one delta-sync pass. Coalesces concurrent calls into a single in-flight run. */
export async function runSync(): Promise<SyncResult> {
	if (typeof navigator !== 'undefined' && !navigator.onLine) return EMPTY_RESULT;
	if (inflight) return inflight;
	inflight = doSync().finally(() => {
		inflight = null;
	});
	return inflight;
}

async function doSync(): Promise<SyncResult> {
	const db = getOfflineDB();
	const meta = await db.syncMeta.get('cursors');
	const stored = meta?.value as SyncCursors | null;
	let discussionsCursor = stored?.discussions;
	let repliesCursor = stored?.replies;
	let discussionTombstoneCursor = stored?.discussionTombstoneCursor;
	let replyTombstoneCursor = stored?.replyTombstoneCursor;

	let totalDisc = 0;
	let totalRep = 0;
	let totalTomb = 0;

	for (let page = 0; page < MAX_PAGES; page++) {
		const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
		if (discussionsCursor) params.set('discussionsCursor', discussionsCursor);
		if (repliesCursor) params.set('repliesCursor', repliesCursor);
		if (discussionTombstoneCursor)
			params.set('discussionTombstoneCursor', discussionTombstoneCursor);
		if (replyTombstoneCursor) params.set('replyTombstoneCursor', replyTombstoneCursor);

		const res = await fetch(`/api/sync/content?${params.toString()}`);
		if (!res.ok) throw new Error(`content sync failed: ${res.status}`);
		const data: SyncContentResponse = await res.json();
		const now = Date.now();

		// Apply this page atomically: upsert new/edited, delete tombstones.
		await db.transaction('rw', db.discussions, db.replies, db.users, async () => {
			if (data.discussions.length) {
				await db.discussions.bulkPut(data.discussions.map((d) => ({ ...d, cachedAt: now })));
			}
			if (data.replies.length) {
				await db.replies.bulkPut(data.replies.map((r) => ({ ...r, cachedAt: now })));
			}
			if (data.users.length) {
				await db.users.bulkPut(data.users.map((u) => ({ ...u, cachedAt: now })));
			}
			for (const t of data.discussionTombstones) await db.discussions.delete(t.id);
			for (const t of data.replyTombstones) await db.replies.delete(t.id);
		});

		totalDisc += data.discussions.length;
		totalRep += data.replies.length;
		totalTomb += data.discussionTombstones.length + data.replyTombstones.length;

		// Persist advanced cursors + server-echoed snapshots before continuing, so a
		// mid-sync abort retries the same page (cursors only move after a 200).
		const cursors: SyncCursors = data.cursors;
		discussionsCursor = cursors.discussions;
		repliesCursor = cursors.replies;
		discussionTombstoneCursor = cursors.discussionTombstoneCursor;
		replyTombstoneCursor = cursors.replyTombstoneCursor;
		await db.syncMeta.bulkPut([
			{ key: 'cursors', value: cursors },
			{ key: 'retentionDays', value: data.retentionDays },
			{ key: 'serverTimeSkew', value: data.serverTimeSeconds - Math.floor(now / 1000) },
			{ key: 'frontPageSnapshot', value: data.frontPageDiscussionIds },
			{ key: 'bookmarksSnapshot', value: data.bookmarkedDiscussionIds },
			{ key: 'lastSyncAt', value: now }
		]);

		const more = data.hasMore.discussions || data.hasMore.replies || data.hasMore.tombstones;
		if (!more) break;
	}

	await applyEviction();
	await flushPendingReadState();
	await backfillMissingUsers();

	return { discussions: totalDisc, replies: totalRep, tombstones: totalTomb };
}

async function backfillMissingUsers(): Promise<void> {
	const db = getOfflineDB();
	const allDisc = await db.discussions.toArray();
	const allRep = await db.replies.toArray();
	const authorIds = new Set<number>();
	for (const d of allDisc) authorIds.add(d.authorId);
	for (const r of allRep) {
		authorIds.add(r.authorId);
		if (r.editedBy) authorIds.add(r.editedBy);
	}
	const cachedUserIds = new Set((await db.users.toArray()).map((u) => u.id));
	const missing = [...authorIds].filter(
		(id) => !cachedUserIds.has(id) && Number.isFinite(id) && id > 0
	);
	if (missing.length === 0) return;

	const BATCH = 500;
	for (let i = 0; i < missing.length; i += BATCH) {
		const batch = missing.slice(i, i + BATCH);
		const res = await fetch(`/api/sync/content?backfillUserIds=${batch.join(',')}`);
		if (!res.ok) return;
		const data = (await res.json()) as BackfillUsersResponse;
		if (data.users?.length) {
			const now = Date.now();
			await db.users.bulkPut(
				data.users.map((u) => ({
					id: u.id,
					displayName: u.displayName,
					username: u.username,
					avatarFileId: u.avatarFileId,
					avatarContentType: u.avatarContentType ?? null,
					cachedAt: now
				}))
			);
		}
	}
}

interface BackfillUsersResponse {
	users?: SyncUserDTO[];
}

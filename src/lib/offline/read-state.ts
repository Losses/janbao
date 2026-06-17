import { getOfflineDB } from './idb';
import type { OfflineReadState, ReadStateKey } from './types';
import type { SyncReadStateResponse } from '$lib/types/api';

const FLUSH_BATCH = 200;

/**
 * Record a read that happened while offline: append to the outbox and update the
 * merged display state (last-write-wins locally). The outbox is flushed to the
 * server by `flushPendingReadState` on reconnect.
 */
export async function recordOfflineRead(
	discussionId: number,
	lastReadReplyId: number | null,
	lastReadPage: number
): Promise<void> {
	const db = getOfflineDB();
	const lastReadAt = Math.floor(Date.now() / 1000);
	await db.transaction('rw', db.readStatePending, db.readStateMerged, async () => {
		await db.readStatePending.put({ discussionId, lastReadReplyId, lastReadPage, lastReadAt });
		const existing = await db.readStateMerged.get(discussionId);
		if (!existing || existing.lastReadAt <= lastReadAt) {
			await db.readStateMerged.put({ discussionId, lastReadReplyId, lastReadPage, lastReadAt });
		}
	});
}

/** Flush the offline read-state outbox to the server (last-write-wins). */
export async function flushPendingReadState(): Promise<void> {
	const db = getOfflineDB();
	const pending = await db.readStatePending.toArray();
	if (pending.length === 0) return;

	// Dedupe to the highest lastReadAt per discussion so repeated reads of the
	// same thread collapse to one delta.
	const byDisc = new Map<number, OfflineReadState>();
	for (const p of pending) {
		const cur = byDisc.get(p.discussionId);
		if (!cur || p.lastReadAt > cur.lastReadAt) byDisc.set(p.discussionId, p);
	}
	const deltas = [...byDisc.values()];

	for (let i = 0; i < deltas.length; i += FLUSH_BATCH) {
		const batch = deltas.slice(i, i + FLUSH_BATCH);
		const res = await fetch('/api/sync/read-state', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ deltas: batch })
		});
		if (!res.ok) throw new Error(`read-state sync failed: ${res.status}`);
		const body = (await res.json()) as SyncReadStateResponse;
		await db.readStatePending.bulkDelete(
			batch.map((d) => [d.discussionId, d.lastReadAt] as ReadStateKey)
		);
		for (const c of body.conflicts) {
			await db.readStateMerged.put({
				discussionId: c.discussionId,
				lastReadReplyId: c.serverLastReadReplyId,
				lastReadPage: 0,
				lastReadAt: c.serverLastReadAt
			});
		}
	}
}

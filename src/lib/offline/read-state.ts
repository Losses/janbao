import { getOfflineDB } from './idb';
import type { OfflineReadState, ReadStateKey } from './types';
import type { SyncReadStateResponse } from '$lib/types/api';

const FLUSH_BATCH = 200;

/**
 * Record a read that happened while offline: append to the outbox and update the
 * merged display state (last-write-wins locally). The outbox is flushed to the
 * server by `flushPendingReadState` on reconnect.
 *
 * `lastReadAt` is stamped in approximate server time (client now + persisted
 * serverTimeSkew) so the server-side last-write-wins comparison is against the
 * server's own clock, not a drifted client clock.
 */
export async function recordOfflineRead(
	discussionId: number,
	lastReadReplyId: number | null,
	lastReadPage: number
): Promise<void> {
	const db = getOfflineDB();
	const skewRow = await db.syncMeta.get('serverTimeSkew');
	const skew = typeof skewRow?.value === 'number' ? skewRow.value : 0;
	const lastReadAt = Math.floor(Date.now() / 1000) + skew;
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

		// Reconcile merged display state with server winners BEFORE clearing the
		// outbox, so a failure here doesn't lose the outbox rows we still need.
		for (const c of body.conflicts) {
			await db.readStateMerged.put({
				discussionId: c.discussionId,
				lastReadReplyId: c.serverLastReadReplyId,
				lastReadPage: 1,
				lastReadAt: c.serverLastReadAt
			});
		}
		// Drain the outbox per discussion up to and including the sent read.
		// The compound range preserves any newer read recorded during the flush
		// while clearing the winner and its older siblings.
		for (const d of batch) {
			const upper = [d.discussionId, d.lastReadAt] as ReadStateKey;
			const lower = [d.discussionId, 0] as ReadStateKey;
			await db.readStatePending
				.where('[discussionId+lastReadAt]')
				.between(lower, upper, true, true)
				.delete();
		}
	}
}

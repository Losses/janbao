import { getOfflineDB } from './idb';
import { applyEviction } from './evict';
import { flushPendingReadState } from './read-state';
import { computeCachedRanges, isComplete } from './manifest';
import { readOfflinePrefs, type OfflinePrefs, type OfflineReplyDepth } from './prefs';
import type {
	CachedDiscussion,
	CachedRange,
	CuratedSyncMetaMap,
	CuratedSyncMetaRecord,
	Reason,
	ReplyCacheManifestRow,
	SyncResult
} from './types';
import type {
	CuratedDiscussionIdSets,
	SyncContentResponse,
	SyncCursors,
	SyncUserDTO
} from '$lib/types/api';

const PAGE_LIMIT = 100;
// Cap pages per run so a single reconnect never loops unboundedly through a huge
// back-history. The cursor persists between runs, so a capped run simply resumes
// next time.
const MAX_PAGES = 20;

const EMPTY_RESULT: SyncResult = { discussions: 0, replies: 0, tombstones: 0 };

let inflight: Promise<SyncResult> | null = null;

interface CategoryReasonBinding {
	category: keyof CuratedDiscussionIdSets;
	reason: Reason;
}

// Map each curated category toggle to its reason enum. Order is fixed so the
// syncMeta mirror stays deterministic for diffing (C05).
const CATEGORY_BINDINGS: readonly CategoryReasonBinding[] = [
	{ category: 'latest', reason: 'latest' },
	{ category: 'mostViewed', reason: 'mostViewed' },
	{ category: 'mostReplied', reason: 'mostReplied' }
];

interface EnabledCategories {
	enabled: CategoryReasonBinding[];
	csv: string;
}

// Resolve prefs to the curated categories + query string. When the feature is
// off OR no categories are toggled on, returns the empty set so the request is
// byte-identical to DV06 (categories=, depth=firstLast). INV-7: the server is
// stateless re: prefs - everything it learns about curation arrives via query
// params.
function resolveEnabledCategories(prefs: OfflinePrefs): EnabledCategories {
	if (!prefs.enabled) return { enabled: [], csv: '' };
	const enabled: CategoryReasonBinding[] = [];
	for (const b of CATEGORY_BINDINGS) {
		if (prefs.categories[b.category]) enabled.push(b);
	}
	if (enabled.length === 0) return { enabled: [], csv: '' };
	return { enabled, csv: enabled.map((b) => b.category).join(',') };
}

function resolveDepth(prefs: OfflinePrefs): OfflineReplyDepth {
	// !enabled OR no selected categories ⇒ DV06 wire shape (firstLast).
	// Otherwise the user's chosen depth applies.
	if (!prefs.enabled) return 'firstLast';
	const anyCategory =
		prefs.categories.latest || prefs.categories.mostViewed || prefs.categories.mostReplied;
	return anyCategory ? prefs.depth : 'firstLast';
}

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
	const prefs = readOfflinePrefs();
	const enabledCats = resolveEnabledCategories(prefs);
	const depth = resolveDepth(prefs);

	const meta = await db.syncMeta.get('cursors');
	const stored = meta?.value as SyncCursors | null;
	let discussionsCursor = stored?.discussions;
	let repliesCursor = stored?.replies;
	let discussionTombstoneCursor = stored?.discussionTombstoneCursor;
	let replyTombstoneCursor = stored?.replyTombstoneCursor;

	let totalDisc = 0;
	let totalRep = 0;
	let totalTomb = 0;

	// Curated id sets + front/bookmark ids seen on the final page; reasons are
	// applied once at the end so a multi-page sync reflects the latest server
	// snapshot (the server ships the same curated/front/bookmark sets on every
	// page - they are snapshots, not deltas).
	let latestCurated: CuratedDiscussionIdSets = {};
	let latestFront: number[] = [];
	let latestBookmarks: number[] = [];
	let latestReplyPageSize = 0;

	for (let page = 0; page < MAX_PAGES; page++) {
		const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
		if (discussionsCursor) params.set('discussionsCursor', discussionsCursor);
		if (repliesCursor) params.set('repliesCursor', repliesCursor);
		if (discussionTombstoneCursor)
			params.set('discussionTombstoneCursor', discussionTombstoneCursor);
		if (replyTombstoneCursor) params.set('replyTombstoneCursor', replyTombstoneCursor);
		// DV07 prefs surface as query params. The empty-categories path matches
		// DV06 exactly (no curated sets returned, firstLast depth).
		params.set('categories', enabledCats.csv);
		params.set('depth', depth);

		const res = await fetch(`/api/sync/content?${params.toString()}`);
		if (!res.ok) throw new Error(`content sync failed: ${res.status}`);
		const data: SyncContentResponse = await res.json();
		const now = Date.now();

		// Apply this page atomically: upsert new/edited, delete tombstones.
		// Existing rows keep their `reasons` / `readUpdatedAt` (the upsert below
		// only refreshes content + cachedAt); reason recompute happens once at
		// the end via applyReasonSets so a tombstone that wipes a row mid-loop
		// can't leave a dangling reason on the survivor.
		await db.transaction('rw', db.discussions, db.replies, db.users, db.activities, async () => {
			if (data.discussions.length) {
				// Carry forward the row's existing reasons/readUpdatedAt across
				// the content upsert. The category/front/bookmark reasons are
				// recomputed authoritatively after the loop; 'read' is owned by
				// the passthrough layer (C04) and is never touched here.
				const incomingIds = data.discussions.map((d) => d.id);
				const existingById = new Map<number, CachedDiscussion>();
				const existingRows = await db.discussions.bulkGet(incomingIds);
				for (const ex of existingRows) {
					if (ex) existingById.set(ex.id, ex);
				}
				const merged: CachedDiscussion[] = data.discussions.map((d) =>
					mergeDiscussionUpsert(d, existingById.get(d.id), now)
				);
				await db.discussions.bulkPut(merged);
			}
			if (data.replies.length) {
				await db.replies.bulkPut(data.replies.map((r) => ({ ...r, cachedAt: now })));
			}
			if (data.users.length) {
				await db.users.bulkPut(data.users.map((u) => ({ ...u, cachedAt: now })));
			}
			for (const t of data.discussionTombstones) await db.discussions.delete(t.id);
			for (const t of data.replyTombstones) await db.replies.delete(t.id);
			if (data.backfillReplies.length) {
				await db.replies.bulkPut(data.backfillReplies.map((r) => ({ ...r, cachedAt: now })));
			}
			// Activities are a first-page snapshot: clear + repopulate so rows that
			// scrolled off the feed don't linger. Idempotent across sync pages.
			await db.activities.clear();
			if (data.activities.length) {
				await db.activities.bulkPut(data.activities.map((a) => ({ ...a, cachedAt: now })));
			}
		});

		totalDisc += data.discussions.length;
		totalRep += data.replies.length;
		totalTomb += data.discussionTombstones.length + data.replyTombstones.length;

		latestCurated = data.curatedDiscussionIds;
		latestFront = data.frontPageDiscussionIds;
		latestBookmarks = data.bookmarkedDiscussionIds;
		latestReplyPageSize = data.replyPageSize;

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
			{ key: 'partialReplyDiscussions', value: data.partialReplyDiscussionIds },
			{ key: 'replyPageSize', value: data.replyPageSize },
			{ key: 'lastSyncAt', value: now }
		]);

		const more = data.hasMore.discussions || data.hasMore.replies || data.hasMore.tombstones;
		if (!more) break;
	}

	// DV07: apply reason sets + populate reply-cache manifest now that the final
	// server snapshot is known. Reads back the upserted discussions so reasons
	// reflect their actual content (a backfilled curated entrant has
	// commentCount populated; the manifest needs it for totalPages).
	await applyReasonSets(latestCurated, latestFront, latestBookmarks, enabledCats.enabled);
	await populateReplyManifests(
		latestCurated,
		latestFront,
		latestBookmarks,
		depth,
		latestReplyPageSize
	);

	await applyEviction();
	await flushPendingReadState();
	await backfillMissingUsers();

	return { discussions: totalDisc, replies: totalRep, tombstones: totalTomb };
}

// Merge incoming discussion content with the row's existing DV07 bookkeeping
// (reasons / readUpdatedAt). bulkPut can't run an async mapper per row, so the
// caller awaits these in a separate pass before bulkPut. We avoid that pattern
// here by doing the merge eagerly: read-then-write would race under multi-tab
// HMR; instead we upsert the merged snapshot, carrying forward any prior
// reasons/readUpdatedAt untouched (the reason recompute below is authoritative
// for category/front/bookmark reasons; 'read' is owned by the passthrough layer).
function mergeDiscussionUpsert(
	incoming: SyncContentResponse['discussions'][number],
	existing: CachedDiscussion | undefined,
	now: number
): CachedDiscussion {
	const merged: CachedDiscussion = { ...incoming, cachedAt: now };
	if (existing?.reasons) merged.reasons = existing.reasons;
	if (existing?.readUpdatedAt !== undefined) merged.readUpdatedAt = existing.readUpdatedAt;
	return merged;
}

interface ReasonDelta {
	add: Set<number>;
	remove: Set<number>;
}

// Recompute the curated/front/bookmark reasons across the cache:
//   - For every enabled category, union that category's reason onto every id
//     in the freshly-fetched set; remove it from ids no longer in the set.
//   - Front + bookmark are mirrored into reasons the same way (unifying DV06's
//     exemption into the reason set so eviction by empty-reasons covers them).
//   - 'read' is never touched here - passthrough (C04) owns it.
//
// The curated.{cat} records are mirrored into syncMeta so C05 can diff the
// next sync's sets against them. fetchAt is the sync's wall-clock start so
// the diff is monotone even across reconnects within the same second.
async function applyReasonSets(
	curated: CuratedDiscussionIdSets,
	front: number[],
	bookmarks: number[],
	enabledCats: CategoryReasonBinding[]
): Promise<void> {
	const db = getOfflineDB();
	const fetchedAt = Date.now();

	// Build per-reason add/remove maps from the new snapshots.
	const addByReason = new Map<Reason, Set<number>>();
	const removeByReason = new Map<Reason, Set<number>>();

	function ensure(reason: Reason): ReasonDelta {
		let add = addByReason.get(reason);
		let remove = removeByReason.get(reason);
		if (!add) {
			add = new Set<number>();
			addByReason.set(reason, add);
		}
		if (!remove) {
			remove = new Set<number>();
			removeByReason.set(reason, remove);
		}
		return { add, remove };
	}

	// Curated reasons only apply to enabled categories. A category the user
	// toggled off mid-session must shed its reason so the row drops out on the
	// next empty-reasons eviction - hence we always compute remove from the
	// ids that USED to carry it.
	const curatedMap: CuratedSyncMetaMap = {};
	for (const b of CATEGORY_BINDINGS) {
		const priorRow = await db.syncMeta.get(`curated:${b.category}`);
		const prior =
			typeof priorRow?.value === 'object' && priorRow?.value !== null
				? (priorRow.value as CuratedSyncMetaRecord)
				: undefined;
		const priorIds = prior?.ids ?? [];
		const isActive = enabledCats.some((e) => e.category === b.category);
		const nextIds = isActive ? (curated[b.category] ?? []) : [];

		const delta = ensure(b.reason);
		for (const id of nextIds) delta.add.add(id);
		for (const id of priorIds) {
			if (!nextIds.includes(id)) delta.remove.add(id);
		}

		// Mirror for C05 diffing. Always written (even when inactive) so the
		// next sync sees an empty set rather than a stale prior snapshot.
		curatedMap[b.category] = { ids: nextIds, fetchedAt };
	}

	// Front + bookmark reasons. The server echoes the full snapshot on every
	// page, so the latest one is authoritative.
	const frontDelta = ensure('front');
	for (const id of front) frontDelta.add.add(id);
	const frontRow = await db.syncMeta.get('frontPageSnapshot');
	const priorFront = Array.isArray(frontRow?.value)
		? (frontRow.value.filter((v) => typeof v === 'number') as number[])
		: [];
	for (const id of priorFront) {
		if (!front.includes(id)) frontDelta.remove.add(id);
	}

	const bookmarkDelta = ensure('bookmark');
	for (const id of bookmarks) bookmarkDelta.add.add(id);
	const bookmarkRow = await db.syncMeta.get('bookmarksSnapshot');
	const priorBookmarks = Array.isArray(bookmarkRow?.value)
		? (bookmarkRow.value.filter((v) => typeof v === 'number') as number[])
		: [];
	for (const id of priorBookmarks) {
		if (!bookmarks.includes(id)) bookmarkDelta.remove.add(id);
	}

	// Apply the delta to every affected row. We touch only rows whose reason
	// set actually changes so a no-op sync doesn't churn the discussion store.
	const affectedIds = new Set<number>();
	for (const set of [...addByReason.values(), ...removeByReason.values()]) {
		for (const id of set) affectedIds.add(id);
	}
	if (affectedIds.size === 0) {
		await persistCuratedMeta(curatedMap);
		return;
	}

	const rows = await db.discussions.bulkGet([...affectedIds]);
	const updates: CachedDiscussion[] = [];
	for (const row of rows) {
		if (!row) continue;
		const nextReasons = recomputeReasons(row, addByReason, removeByReason);
		// 'read' is preserved across curated/front/bookmark recompute - only
		// passthrough (C04) / TTL (C05) may touch it.
		updates.push({ ...row, reasons: nextReasons });
	}
	if (updates.length) await db.discussions.bulkPut(updates);
	await persistCuratedMeta(curatedMap);
}

function recomputeReasons(
	row: CachedDiscussion,
	addByReason: Map<Reason, Set<number>>,
	removeByReason: Map<Reason, Set<number>>
): Reason[] {
	const set = new Set<Reason>(row.reasons ?? []);
	for (const [reason, ids] of addByReason) {
		if (ids.has(row.id)) set.add(reason);
	}
	for (const [reason, ids] of removeByReason) {
		if (ids.has(row.id)) set.delete(reason);
	}
	// Deterministic order so the row's reasons array is stable across syncs
	// (avoids spurious diff noise in C05 / displays).
	const ORDER: readonly Reason[] = [
		'latest',
		'mostViewed',
		'mostReplied',
		'read',
		'front',
		'bookmark'
	];
	return ORDER.filter((r) => set.has(r));
}

async function persistCuratedMeta(map: CuratedSyncMetaMap): Promise<void> {
	const db = getOfflineDB();
	const rows = [
		{ key: 'curated:latest', value: map.latest ?? { ids: [], fetchedAt: Date.now() } },
		{ key: 'curated:mostViewed', value: map.mostViewed ?? { ids: [], fetchedAt: Date.now() } },
		{ key: 'curated:mostReplied', value: map.mostReplied ?? { ids: [], fetchedAt: Date.now() } }
	];
	await db.syncMeta.bulkPut(rows);
}

// One manifest row per discussion that received depth-aware backfill, derived
// from the depth policy + the row's commentCount / pageSize. Overwritten on
// every sync so a thread that grew past the cap flips from complete to
// first/last split on the next refresh.
async function populateReplyManifests(
	curated: CuratedDiscussionIdSets,
	front: number[],
	bookmarks: number[],
	depth: OfflineReplyDepth,
	pageSize: number
): Promise<void> {
	if (pageSize <= 0) return;
	const db = getOfflineDB();
	const ids = new Set<number>([...front, ...bookmarks]);
	for (const cat of CATEGORY_BINDINGS) {
		for (const id of curated[cat.category] ?? []) ids.add(id);
	}
	if (ids.size === 0) return;
	const rows = await db.discussions.bulkGet([...ids]);
	const manifests: ReplyCacheManifestRow[] = [];
	for (const row of rows) {
		if (!row) continue;
		const totalPages = Math.max(1, Math.ceil(row.commentCount / pageSize));
		const cachedRanges: CachedRange[] = computeCachedRanges(depth, totalPages, pageSize);
		manifests.push({
			discussionId: row.id,
			totalPages,
			pageSize,
			cachedRanges,
			complete: isComplete(cachedRanges, totalPages)
		});
	}
	if (manifests.length) await db.replyCacheManifest.bulkPut(manifests);
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

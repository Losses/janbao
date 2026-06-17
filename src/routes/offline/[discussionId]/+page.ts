import { getOfflineDB } from '$lib/offline/idb';
import type { PageLoad } from './$types';

// Client-only: reads the cached discussion + its replies from IndexedDB. Has no
// +page.server.ts by design (INV-4) - it cannot trigger the online read mechanism.
export const ssr = false;

export const load: PageLoad = async ({ params }) => {
	const discussionId = Number(params.discussionId);
	const db = getOfflineDB();
	const discussion = (await db.discussions.get(discussionId)) ?? null;
	const replies = await db.replies.where('discussionId').equals(discussionId).sortBy('createdAt');
	return { discussion, replies, discussionId };
};

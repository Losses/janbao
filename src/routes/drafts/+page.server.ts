import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { drafts } from '$lib/server/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';

// Per RQ00-Frontend §6.10, the drafts list only shows thread-creation drafts
// and discussion-reply drafts (filtering out private-message and activity drafts).
const VISIBLE_CONTEXT_TYPES = ['discussion', 'reply'];

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, '/entry/signin');
	}

	const rows = await event.locals.db
		.select({
			id: drafts.id,
			contextType: drafts.contextType,
			contextId: drafts.contextId,
			contentJson: drafts.contentJson,
			updatedAt: drafts.updatedAt
		})
		.from(drafts)
		.where(and(eq(drafts.authorId, user.id), inArray(drafts.contextType, VISIBLE_CONTEXT_TYPES)))
		.orderBy(desc(drafts.updatedAt));

	return { drafts: rows };
};

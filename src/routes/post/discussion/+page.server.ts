import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	categories,
	categoryPermissions,
	discussions,
	replies,
	drafts
} from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { generateSlug } from '$lib/utils/slug';
import { resolvePermissions, resolveGroupSlug } from '$lib/server/constants';
import type { DbTransaction } from '$lib/server/db';
import { indexDiscussionTitle, indexReply } from '$lib/server/search/fts';
import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, `/entry/signin?redirectTo=/post/discussion`);
	}

	const db = event.locals.db;
	const groupSlug = resolveGroupSlug(user);

	// 1. Fetch categories
	const allCategories = await db.select().from(categories).orderBy(categories.displayOrder);

	// 2. Batch-fetch permissions for this group across all categories (2 queries total)
	const perms = await db
		.select({
			categorySlug: categoryPermissions.categorySlug,
			canCreate: categoryPermissions.canCreate
		})
		.from(categoryPermissions)
		.where(eq(categoryPermissions.groupSlug, groupSlug));

	const permMap = new Map(perms.map((p) => [p.categorySlug, p.canCreate]));

	// Apply defaults based on groupSlug
	const isPrivileged = groupSlug === 'admin' || groupSlug === 'moderator';
	const defaultCanCreate = groupSlug === 'member' ? true : false;

	const writeableCategories = isPrivileged
		? allCategories
		: allCategories.filter((cat) => {
				const canCreate = permMap.get(cat.slug);
				return canCreate === undefined ? defaultCanCreate : canCreate;
			});

	// 3. Find default category (highest priority)
	let defaultCategorySlug = '';
	if (writeableCategories.length > 0) {
		const sorted = [...writeableCategories].sort((a, b) => b.priority - a.priority);
		defaultCategorySlug = sorted[0].slug;
	}

	// 4. Fetch existing creation draft if any (contextId = 0 marks the "new" draft)
	const draftRecord = await db
		.select({ contentJson: drafts.contentJson })
		.from(drafts)
		.where(
			and(
				eq(drafts.authorId, user.id),
				eq(drafts.contextType, 'discussion'),
				eq(drafts.contextId, 0)
			)
		)
		.limit(1);

	const draftContent = draftRecord.length > 0 ? draftRecord[0].contentJson : null;

	return {
		categories: writeableCategories,
		defaultCategorySlug,
		draftContent
	};
};

export const actions: Actions = {
	publish: async (event) => {
		const user = event.locals.user;
		if (!user) {
			error(401, event.locals.t.common.unauthorized);
		}

		const db = event.locals.db;
		const data = await event.request.formData();
		const title = data.get('title') as string;
		const categorySlug = data.get('categorySlug') as string;
		const themeName = (data.get('themeName') as string) || null;
		const contentJson = data.get('contentJson') as string;

		if (!title || title.trim() === '') {
			return { success: false, error: event.locals.t.discussion.titleEmpty };
		}
		if (!categorySlug) {
			return { success: false, error: event.locals.t.discussion.categoryEmpty };
		}
		if (isLexicalEmpty(contentJson)) {
			return { success: false, error: event.locals.t.common.contentRequired };
		}
		if (contentJson.length > MAX_CONTENT_SIZE) {
			return { success: false, error: event.locals.t.common.contentTooLarge };
		}

		// Check permission via centralized resolver
		const perms = await resolvePermissions(db, categorySlug, user);
		if (!perms.canCreate) {
			return { success: false, error: event.locals.t.discussion.noPermission };
		}

		const slug = generateSlug(title);
		let discussionId: number;

		try {
			// Insert discussion + OP reply + clear draft atomically, keeping the
			// FTS index in sync within the same transaction.
			discussionId = await db.transaction(async (tx: DbTransaction) => {
				const inserted = await tx
					.insert(discussions)
					.values({
						title,
						slug,
						categorySlug,
						authorId: user.id,
						themeName,
						viewCount: 0,
						commentCount: 0,
						isPinned: false,
						createdAt: new Date(),
						updatedAt: new Date()
					})
					.returning({ id: discussions.id });
				const did = inserted[0].id;
				await indexDiscussionTitle(tx, did, title);

				// Insert OP reply (as index 0 reply); id is auto-assigned
				const opInserted = await tx
					.insert(replies)
					.values({
						discussionId: did,
						authorId: user.id,
						contentJson,
						createdAt: new Date(),
						updatedAt: new Date()
					})
					.returning({ id: replies.id });
				await indexReply(tx, opInserted[0].id, contentJson);

				// Clear draft (contextId = 0 marks the "new" discussion composer draft)
				await tx
					.delete(drafts)
					.where(
						and(
							eq(drafts.authorId, user.id),
							eq(drafts.contextType, 'discussion'),
							eq(drafts.contextId, 0)
						)
					);
				return did;
			});
		} catch (err) {
			console.error('Failed to publish discussion:', err);
			return { success: false, error: event.locals.t.discussion.publishFailed };
		}

		redirect(302, `/discussion/${discussionId}/${slug}`);
	}
};

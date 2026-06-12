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

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, `/entry/signin?redirectTo=/post/discussion`);
	}

	const db = event.locals.db;

	// 1. Fetch categories
	const allCategories = await db.select().from(categories).orderBy(categories.displayOrder);

	// 2. Filter writable categories
	const writeableCategories = [];
	for (const cat of allCategories) {
		const perm = await db
			.select()
			.from(categoryPermissions)
			.where(
				and(
					eq(categoryPermissions.categorySlug, cat.slug),
					eq(categoryPermissions.groupSlug, user.groupSlug)
				)
			)
			.limit(1);

		const canCreate = perm.length === 0 ? true : perm[0].canCreate;
		if (canCreate) {
			writeableCategories.push(cat);
		}
	}

	// 3. Find default category (highest priority)
	let defaultCategorySlug = '';
	if (writeableCategories.length > 0) {
		const sorted = [...writeableCategories].sort((a, b) => b.priority - a.priority);
		defaultCategorySlug = sorted[0].slug;
	}

	// 4. Fetch existing creation draft if any
	const draftRecord = await db
		.select({ contentJson: drafts.contentJson })
		.from(drafts)
		.where(
			and(
				eq(drafts.authorId, user.id),
				eq(drafts.contextType, 'discussion'),
				eq(drafts.contextId, 'new')
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
			error(401, 'Unauthorized');
		}

		const db = event.locals.db;
		const data = await event.request.formData();
		const title = data.get('title') as string;
		const categorySlug = data.get('categorySlug') as string;
		const themeName = (data.get('themeName') as string) || null;
		const contentJson = data.get('contentJson') as string;

		if (!title || title.trim() === '') {
			return { success: false, error: 'Title cannot be empty' };
		}
		if (!categorySlug) {
			return { success: false, error: 'Category must be selected' };
		}
		if (!contentJson) {
			return { success: false, error: 'Content cannot be empty' };
		}

		// Check permission
		const perm = await db
			.select()
			.from(categoryPermissions)
			.where(
				and(
					eq(categoryPermissions.categorySlug, categorySlug),
					eq(categoryPermissions.groupSlug, user.groupSlug)
				)
			)
			.limit(1);

		const canCreate = perm.length === 0 ? true : perm[0].canCreate;
		if (!canCreate) {
			return { success: false, error: 'You do not have permission to post in this category' };
		}

		const discussionId = crypto.randomUUID();
		const slug = generateSlug(title);

		try {
			// Insert discussion
			await db.insert(discussions).values({
				id: discussionId,
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
			});

			// Insert OP reply (as index 0 reply)
			const opReplyId = crypto.randomUUID();
			await db.insert(replies).values({
				id: opReplyId,
				discussionId,
				authorId: user.id,
				contentJson,
				createdAt: new Date(),
				updatedAt: new Date()
			});

			// Clear draft
			await db
				.delete(drafts)
				.where(
					and(
						eq(drafts.authorId, user.id),
						eq(drafts.contextType, 'discussion'),
						eq(drafts.contextId, 'new')
					)
				);
		} catch (err) {
			console.error('Failed to publish discussion:', err);
			return { success: false, error: 'Failed to save to database' };
		}

		redirect(302, `/discussion/${discussionId}/${slug}`);
	}
};

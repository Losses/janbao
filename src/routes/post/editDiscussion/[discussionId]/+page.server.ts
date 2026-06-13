import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	categories,
	categoryPermissions,
	discussions,
	replies,
	drafts
} from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { generateSlug } from '$lib/utils/slug';
import { resolvePermissions, resolveGroupSlug } from '$lib/server/constants';
import type { DbTransaction } from '$lib/server/db';
import { isLexicalEmpty, MAX_CONTENT_SIZE } from '$lib/utils/lexical';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		redirect(302, `/entry/signin?redirectTo=/post/editDiscussion/${event.params.discussionId}`);
	}

	const db = event.locals.db;
	const discussionId = Number(event.params.discussionId);
	if (!discussionId) {
		error(404, event.locals.t.discussion.notFound);
	}

	// 1. Fetch discussion
	const discussionRecords = await db
		.select({
			id: discussions.id,
			title: discussions.title,
			slug: discussions.slug,
			categorySlug: discussions.categorySlug,
			themeName: discussions.themeName,
			authorId: discussions.authorId
		})
		.from(discussions)
		.where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)))
		.limit(1);

	if (discussionRecords.length === 0) {
		error(404, event.locals.t.discussion.notFound);
	}
	const discussion = discussionRecords[0];

	// 2. Fetch the Original Post (OP) contentJson
	const opRecord = await db
		.select({
			id: replies.id,
			contentJson: replies.contentJson
		})
		.from(replies)
		.where(and(eq(replies.discussionId, discussionId), isNull(replies.deletedAt)))
		.orderBy(replies.createdAt)
		.limit(1);

	if (opRecord.length === 0) {
		error(404, event.locals.t.common.notFound);
	}
	const opReply = opRecord[0];

	// 3. Verify permissions: canUpdate or author
	const perms = await resolvePermissions(db, discussion.categorySlug, user);
	if (!perms.canRead) {
		error(403, event.locals.t.common.forbidden);
	}
	const isAuthor = user.id === discussion.authorId;
	if (!perms.canUpdate && !isAuthor) {
		error(403, event.locals.t.common.forbidden);
	}

	// 4. Fetch writeable categories list
	const groupSlug = resolveGroupSlug(user);
	const allCategories = await db.select().from(categories).orderBy(categories.displayOrder);

	const permsQuery = await db
		.select({
			categorySlug: categoryPermissions.categorySlug,
			canCreate: categoryPermissions.canCreate
		})
		.from(categoryPermissions)
		.where(eq(categoryPermissions.groupSlug, groupSlug));

	const permMap = new Map(permsQuery.map((p) => [p.categorySlug, p.canCreate]));
	const isPrivileged = groupSlug === 'admin' || groupSlug === 'moderator';
	const defaultCanCreate = groupSlug === 'member' ? true : false;

	const writeableCategories = isPrivileged
		? allCategories
		: allCategories.filter((cat) => {
				const canCreate = permMap.get(cat.slug);
				return canCreate === undefined ? defaultCanCreate : canCreate;
			});

	// Ensure the current category is always included in the returned categories list
	const currentCatInList = writeableCategories.some((cat) => cat.slug === discussion.categorySlug);
	if (!currentCatInList) {
		const currentCatRecord = allCategories.find((cat) => cat.slug === discussion.categorySlug);
		if (currentCatRecord) {
			writeableCategories.push(currentCatRecord);
		}
	}

	// 5. Fetch existing edit draft if any
	const draftRecord = await db
		.select({ contentJson: drafts.contentJson })
		.from(drafts)
		.where(
			and(
				eq(drafts.authorId, user.id),
				eq(drafts.contextType, 'discussion'),
				eq(drafts.contextId, discussionId)
			)
		)
		.limit(1);

	const draftContent = draftRecord.length > 0 ? draftRecord[0].contentJson : null;

	return {
		discussion,
		opContentJson: opReply.contentJson,
		categories: writeableCategories,
		draftContent
	};
};

export const actions: Actions = {
	update: async (event) => {
		const user = event.locals.user;
		if (!user) {
			error(401, event.locals.t.common.unauthorized);
		}

		const db = event.locals.db;
		const discussionId = Number(event.params.discussionId);
		if (!discussionId) {
			error(400, event.locals.t.common.badRequest);
		}

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

		// 1. Fetch current discussion record
		const discussionRecords = await db
			.select({
				id: discussions.id,
				authorId: discussions.authorId,
				categorySlug: discussions.categorySlug
			})
			.from(discussions)
			.where(and(eq(discussions.id, discussionId), isNull(discussions.deletedAt)))
			.limit(1);

		if (discussionRecords.length === 0) {
			error(404, event.locals.t.discussion.notFound);
		}
		const discussion = discussionRecords[0];

		// Check permission: canUpdate permission or author
		const perms = await resolvePermissions(db, discussion.categorySlug, user);
		if (!perms.canRead) {
			error(403, event.locals.t.common.forbidden);
		}
		const isAuthor = user.id === discussion.authorId;
		if (!perms.canUpdate && !isAuthor) {
			error(403, event.locals.t.common.forbidden);
		}

		// If category is changing, check if target category exists and if user has permission to post in it
		if (discussion.categorySlug !== categorySlug) {
			const categoryRecord = await db
				.select({ slug: categories.slug })
				.from(categories)
				.where(eq(categories.slug, categorySlug))
				.limit(1);

			if (categoryRecord.length === 0) {
				return { success: false, error: event.locals.t.category.notFound };
			}

			const newCategoryPerms = await resolvePermissions(db, categorySlug, user);
			if (!newCategoryPerms.canCreate) {
				return { success: false, error: event.locals.t.discussion.noPermission };
			}
		}

		// 2. Fetch the OP reply record to update its content
		const opRecord = await db
			.select({ id: replies.id })
			.from(replies)
			.where(and(eq(replies.discussionId, discussionId), isNull(replies.deletedAt)))
			.orderBy(replies.createdAt)
			.limit(1);

		if (opRecord.length === 0) {
			error(500, event.locals.t.common.internalError);
		}
		const opReply = opRecord[0];

		const slug = generateSlug(title);

		try {
			await db.transaction(async (tx: DbTransaction) => {
				// Update discussion title, slug, categorySlug, themeName, updatedAt
				await tx
					.update(discussions)
					.set({
						title,
						slug,
						categorySlug,
						themeName,
						updatedAt: new Date()
					})
					.where(eq(discussions.id, discussionId));

				// Update OP reply contentJson, updatedAt
				await tx
					.update(replies)
					.set({
						contentJson,
						updatedAt: new Date()
					})
					.where(eq(replies.id, opReply.id));

				// Clear draft
				await tx
					.delete(drafts)
					.where(
						and(
							eq(drafts.authorId, user.id),
							eq(drafts.contextType, 'discussion'),
							eq(drafts.contextId, discussionId)
						)
					);
			});
		} catch (err) {
			console.error('Failed to update discussion:', err);
			return { success: false, error: event.locals.t.common.internalError };
		}

		redirect(303, `/discussion/${discussionId}/${slug}`);
	}
};

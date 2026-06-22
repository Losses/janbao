import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { categories, discussions } from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { resolvePermissions } from '$lib/server/constants';

export const load: PageServerLoad = async ({ params, locals }) => {
	const discussionId = Number(params.discussionId);
	if (!discussionId) {
		error(404, locals.t.discussion.notFound);
	}
	const db = locals.db;

	// Resolve the slug only for a live discussion in an ENABLED category. This is
	// the only read path that used to skip resolvePermissions + the disabled
	// filter, leaking the slug (title-derived) of a disabled/forbidden-category
	// discussion via the 302 Location header.
	const record = await db
		.select({ slug: discussions.slug, categorySlug: discussions.categorySlug })
		.from(discussions)
		.innerJoin(categories, eq(discussions.categorySlug, categories.slug))
		.where(
			and(
				eq(discussions.id, discussionId),
				isNull(discussions.deletedAt),
				isNull(categories.disabledAt)
			)
		)
		.limit(1);

	if (record.length === 0) {
		error(404, locals.t.discussion.notFound);
	}

	const perms = await resolvePermissions(db, record[0].categorySlug, locals.user);
	if (!perms.canRead) {
		error(403, locals.t.common.forbidden);
	}

	redirect(302, `/discussion/${discussionId}/${record[0].slug}`);
};

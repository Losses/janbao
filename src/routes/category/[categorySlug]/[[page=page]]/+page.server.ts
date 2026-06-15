import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { categories } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { loadDiscussionsPage } from '$lib/server/db/dao/discussions';
import {
	parseDiscussionPageFromPath,
	resolvePermissions,
	resolveGroupSlug
} from '$lib/server/constants';
import { resolveCategoryI18n } from '$lib/server/i18n';

export const load: PageServerLoad = async (event) => {
	const { categorySlug } = event.params;
	const db = event.locals.db;
	const user = event.locals.user;
	const t = event.locals.t;

	// 1. Fetch category
	const categoryRecords = await db
		.select()
		.from(categories)
		.where(eq(categories.slug, categorySlug))
		.limit(1);

	if (categoryRecords.length === 0) {
		error(404, t.category.notFound);
	}
	const category = resolveCategoryI18n(categoryRecords[0], t);

	// 2. Check read permissions (guest-safe via resolvePermissions)
	const perms = await resolvePermissions(db, categorySlug, user);
	if (!perms.canRead) {
		error(403, t.common.forbidden);
	}

	// 3. Parse page from /category/[slug]/pN segment (page 1 = bare /category/[slug])
	const { page, limit, offset } = parseDiscussionPageFromPath(
		event.params.page,
		event.platform?.env
	);

	// 4. Fetch discussions list in this category
	const groupSlug = resolveGroupSlug(user);

	const { discussions, totalPages, totalCount } = await loadDiscussionsPage(db, {
		userId: user?.id ?? null,
		categorySlug,
		groupSlug,
		limit,
		offset
	});

	return {
		category,
		discussions,
		page,
		totalPages,
		totalCount
	};
};
